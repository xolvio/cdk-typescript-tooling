import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";
import * as shelljs from "shelljs";

export const compileCodeEsbuild = ({
  modulesToIgnore = [],
  entryFullPath,
  async,
  forceCompile,
}: {
  modulesToIgnore?: string[];
  entryFullPath: string;
  async?: boolean;
  forceCompile?: boolean;
}): { outputDir: string } | Promise<{ outputDir: string }> => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aws-lambda-nodejs-webpack")
  );

  const options: esbuild.BuildOptions = {
    entryPoints: [entryFullPath],
    bundle: true,
    platform: "node",
    keepNames: true,
    external: ["aws-sdk", ...modulesToIgnore],
    outfile: path.join(outputDir, "main.js"),
    minify: true,
    sourcemap: true,
  };
  if (process.env.NODE_ENV !== "test" || forceCompile) {
    if (async) {
      return new Promise((resolve) => {
        esbuild
          .build(options)
          .then((res) => {
            resolve({ outputDir });
          })
          .catch(() => process.exit(1));
      });
    }
    esbuild.buildSync(options);

    // this is incorrectly typed in shelljs, the array returns an object
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const compiledFiles = shelljs.ls("-l", outputDir).map((a) => a.name);
    if (compiledFiles.length === 0) {
      console.error(
        `No files compiled for: ${entryFullPath}. Something probably went wrong.`
      );
    }
  }

  return { outputDir };
};
