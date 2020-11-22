import * as shelljs from "shelljs";
import { SynthUtils } from "@aws-cdk/assert";
import type { Stack } from "@aws-cdk/core";
import { compileCode } from "./typescriptFunction";

module.exports = (functionPhysicalId: string, stack: Stack) => {
  const functionLogicalId = functionPhysicalId.split("-")[1];
  let info: { entryFullPath: string; functionName: string };
  Object.entries(SynthUtils.synthesize(stack).template.Outputs)
    .filter(([outputId]) => {
      return outputId.indexOf("UploadInfoExtended") > -1;
    })
    .find(([_, output]: [string, any]) => {
      const otherInfo = output.Value["Fn::Join"][1];
      const compiledInfoStringified = `${otherInfo[0]}${otherInfo[1].Ref}${otherInfo[2]}`;
      const compiledInfo = JSON.parse(compiledInfoStringified);

      if (compiledInfo.functionName === functionLogicalId) {
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

    const updateCommand = `aws lambda update-function-code --function-name ${functionPhysicalId} --zip-file fileb://${zippedFunctionPath}`;
    shelljs.exec(updateCommand);
  }
};
