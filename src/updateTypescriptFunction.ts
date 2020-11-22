import * as shelljs from "shelljs";
import * as AWS from "aws-sdk";
import { SynthUtils } from "@aws-cdk/assert";
import type { Stack } from "@aws-cdk/core";
import { compileCode } from "./typescriptFunction";

module.exports = async (functionLogicalId: string, stack: Stack) => {
  let info: { entryFullPath: string; functionName: string };
  const synthesized = SynthUtils.synthesize(stack);
  const { stackName } = synthesized;

  const cloudformation = new AWS.CloudFormation();
  const stackResources = await cloudformation
    .describeStackResources({ StackName: stackName })
    .promise();
  const resource = stackResources?.StackResources?.find(
    (r) => r.LogicalResourceId === functionLogicalId
  );
  if (!resource) {
    throw new Error("not found");
  }
  Object.entries(synthesized.template.Outputs)
    .filter(([outputId]) => {
      return outputId.indexOf("UploadInfoExtended") > -1;
    })
    .find(([_, output]: [string, any]) => {
      const otherInfo = output.Value["Fn::Join"][1];
      const compiledInfoStringified = `${otherInfo[0]}${otherInfo[1].Ref}${otherInfo[2]}`;
      const compiledInfo = JSON.parse(compiledInfoStringified);

      if (compiledInfo.functionName === resource?.LogicalResourceId) {
        info = compiledInfo;
        return compiledInfo;
      }
      return undefined;
    });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (info) {
    process.env.NODE_ENV = "development";

    const { outputDir } = compileCode({
      entryFullPath: info.entryFullPath,
    });

    const zippedFunctionPath = `${outputDir}/function.zip`;
    const zipCommand = `zip function.zip main.js`;
    shelljs.exec(zipCommand, { cwd: outputDir });

    const updateCommand = `aws lambda update-function-code --function-name ${resource.PhysicalResourceId} --zip-file fileb://${zippedFunctionPath}`;
    shelljs.exec(updateCommand);
  }
};
