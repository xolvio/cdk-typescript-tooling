process.env.NODE_ENV = "test";
const [stackPath, functionPhysicalId] = process.argv.slice(2);

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./updateTypeScriptFunction")(
  functionPhysicalId,
  stackPath
).then(() => {});
