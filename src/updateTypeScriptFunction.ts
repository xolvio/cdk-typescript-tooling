import * as shelljs from "shelljs";
import * as AWS from "aws-sdk";
import path from "path";
import fs from "fs";
import { SynthUtils } from "@aws-cdk/assert";
import { exec, execSync } from "child_process";
import { StackResourceSummaries } from "aws-sdk/clients/cloudformation";
import { compileCode } from "./typeScriptFunction";

const getCompiledInfo = (output: any) => {
  const otherInfo = output.Value["Fn::Join"][1];
  const compiledInfoStringified = `${otherInfo[0]}${otherInfo[1].Ref}${otherInfo[2]}`;
  return JSON.parse(compiledInfoStringified);
};

const compileAndUpload = async (
  entryFullPath: string,
  physicalResourceId: string
) => {
  const { outputDir } = await compileCode({
    async: true,
    entryFullPath,
  });
  return new Promise((resolve) => {
    const zippedFunctionPath = `${outputDir}/function.zip`;
    const zipCommand = `zip function.zip main.js`;
    exec(zipCommand, { cwd: outputDir }, (error) => {
      if (error) {
        console.error("Zip Command Error: ", error);
      }
      const updateCommand = `aws lambda update-function-code --function-name ${physicalResourceId} --zip-file fileb://${zippedFunctionPath}`;
      exec(updateCommand, (updateError) => {
        if (updateError) {
          console.error("Update command error", updateError);
        }
        console.log(
          `Lambda updated for ${path.relative(
            process.cwd(),
            entryFullPath
          )}. Run to follow logs:\naws logs tail --follow /aws/lambda/${physicalResourceId}\n`
        );
        resolve("updateCommand");
      });
    });
  });
};

const fetchAllStackResources = async (StackName: string) => {
  const cloudformation = new AWS.CloudFormation();

  const stackResources = await cloudformation
    .listStackResources({ StackName })
    .promise();
  let { NextToken } = stackResources;
  if (stackResources?.StackResourceSummaries?.length) {
    const allResources = [...stackResources!.StackResourceSummaries];
    while (NextToken) {
      // eslint-disable-next-line no-await-in-loop
      const stackResourcesAgain = await cloudformation
        .listStackResources({ StackName, NextToken })
        .promise();
      allResources.push(
        ...(stackResourcesAgain.StackResourceSummaries as StackResourceSummaries)
      );
      ({ NextToken } = stackResourcesAgain);
    }
    return allResources;
  }
  throw new Error(`Did not get any stack resources for ${StackName}`);
};

const getStackResourcesAndUploadInfos = async (
  stackPath: string
): Promise<{
  stackResources: StackResourceSummaries;
  uploadInfos: [string, any][];
}> => {
  return new Promise((resolve) => {
    let cache;
    const cacheDirectory = `${process.cwd()}/.update-function-cache`;
    const cacheFileName = `${process.env.BRANCH}.cache.json`;
    const cacheFilePath = `${cacheDirectory}/${cacheFileName}`;
    try {
      // eslint-disable-next-line global-require,import/no-dynamic-require
      cache = require(cacheFilePath);
      resolve(cache);
    } catch (e) {
      console.log("Cache not found for this branch");
      Promise.resolve(
        // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require,import/no-dynamic-require
        require(path.resolve(process.cwd(), stackPath)).default
      ).then(async (stack) => {
        const synthesized = SynthUtils.synthesize(stack); // cache
        const { stackName } = synthesized;

        const uploadInfos = Object.entries(synthesized.template.Outputs).filter(
          ([outputId]) => {
            return outputId.indexOf("UploadInfoExtended") > -1;
          }
        );
        const stackResources = await fetchAllStackResources(stackName); // cache

        shelljs.mkdir("-p", cacheDirectory);
        fs.writeFileSync(
          cacheFilePath,
          JSON.stringify({ stackResources, uploadInfos })
        );
        resolve({ stackResources, uploadInfos });
      });
    }
  });
};

module.exports = async (functionLogicalId: string, stackPath: string) => {
  if (!process.env.BRANCH) {
    process.env.BRANCH = execSync("git branch --show-current")
      .toString()
      .trim();
  }
  if (
    process.env.BRANCH === "master" &&
    process.env.FORCE_MASTER_UPDATE !== "true"
  ) {
    throw new Error(
      "Uploading to master is disabled by default. " +
        "We highly discourage doing so, but if you must, set FORCE_MASTER_UPDATE env variable to true"
    );
  }
  console.log(
    `\n\nUsing branch ${process.env.BRANCH} as a base for your deployment, kill this process if that is not correct\n\n`
  );
  const { stackResources, uploadInfos } = await getStackResourcesAndUploadInfos(
    stackPath
  );

  process.env.NODE_ENV = "development";

  if (functionLogicalId) {
    const resource = stackResources.find(
      (r) => r.LogicalResourceId === functionLogicalId
    );
    let info: { entryFullPath: string; functionName: string };

    uploadInfos.find(([_, output]: [string, any]) => {
      const compiledInfo = getCompiledInfo(output);

      if (compiledInfo.functionName === resource?.LogicalResourceId) {
        info = compiledInfo;
        return compiledInfo;
      }
      return undefined;
    });

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (info) {
      await compileAndUpload(
        info.entryFullPath,
        resource?.PhysicalResourceId as string
      );
    }
  } else {
    await Promise.all(
      uploadInfos.map(async ([_, output]: [string, any]) => {
        // return new Promise(async (resolve) => {
        const compiledInfo = getCompiledInfo(output);

        const resource = stackResources.find(
          (r) => r.LogicalResourceId === compiledInfo.functionName
        );

        if (resource) {
          await compileAndUpload(
            compiledInfo.entryFullPath,
            resource.PhysicalResourceId as string
          );
        }
        // });
      })
    );
  }
};
