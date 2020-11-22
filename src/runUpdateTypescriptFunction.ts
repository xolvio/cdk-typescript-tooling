#!/usr/bin/env -S node -r "ts-node/register"

/* eslint-disable @typescript-eslint/no-var-requires, import/no-dynamic-require, global-require */
import path from "path";

process.env.NODE_ENV = "test";
const [stackPath, functionPhysicalId] = process.argv.slice(2);

Promise.resolve(require(path.resolve(process.cwd(), stackPath)).default).then(
  async (newStack) => {
    // I'm using require here because I need to be able to setup the NODE_ENV before the uploadNewCode is loaded.
    await require("./updateTypescriptFunction")(functionPhysicalId, newStack);

    console.log(
      "\n\n\nIf you want to look at the logs of this lambda function run:"
    );
    console.log(`aws logs tail --follow /aws/lambda/${functionPhysicalId}`);
  }
);
