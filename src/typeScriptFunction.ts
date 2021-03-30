/* eslint-disable no-new */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as process from "process";
import * as findUp from "find-up";

import * as lambda from "@aws-cdk/aws-lambda";
import * as cdk from "@aws-cdk/core";
import { FilterPattern, SubscriptionFilter } from "@aws-cdk/aws-logs";
import { CfnCondition, CfnOutput, Fn } from "@aws-cdk/core";
import * as LogsDestinations from "@aws-cdk/aws-logs-destinations";
import * as apiGateway2 from "@aws-cdk/aws-apigatewayv2";
import * as apiGateway2Integrations from "@aws-cdk/aws-apigatewayv2-integrations";

import * as shelljs from "shelljs";
import { exec } from "child_process";

let functionsToRunAfter: (() => void)[] = [];

export const compileCode = ({
  modulesToIgnore = [],
  entryFullPath,
  async,
}: {
  modulesToIgnore?: string[];
  entryFullPath: string;
  async?: boolean;
}): { outputDir: string } | Promise<{ outputDir: string }> => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aws-lambda-nodejs-webpack")
  );
  const webpackConfigPath = path.join(outputDir, "webpack.config.js");

  const pluginsPaths = createPluginsPaths();
  const webpackConfiguration = generateWebpackConfig({
    pluginsPaths,
    entryFullPath,
    outputDir,
    modulesToIgnore,
  });

  const webpackBinPath = path.resolve(pluginsPaths.webpack, "bin/webpack");

  fs.writeFileSync(webpackConfigPath, webpackConfiguration);

  // to implement cache, create a script that uses webpack API, store cache in a file with JSON.stringify, based on entry path key then reuse it
  // const webpack = spawnSync(webpackPath, ['--config', webpackConfigPath], {
  //   cwd: process.cwd(),
  //   stdio: 'inherit',
  // })
  const webpackCommand = `node ${webpackBinPath} --config ${webpackConfigPath}`;
  const webpackExecOptions = {
    cwd: process.cwd(),
  };
  if (process.env.NODE_ENV !== "test") {
    if (async) {
      return new Promise((resolve) => {
        exec(webpackCommand, webpackExecOptions, (error) => {
          if (error) {
            console.error(
              "Webpack compilation error for",
              entryFullPath,
              error
            );
          }
          resolve({ outputDir });
        });
      });
    }
    shelljs.exec(webpackCommand, webpackExecOptions);
  }

  // console.log('webpackOutput.stdout', webpackOutput.stdout)
  // console.log('webpackOutput.stderr', webpackOutput.stderr)
  //
  // if (webpackOutput.stderr) {
  //   console.error('webpack had an error when bundling.')
  //   console.error('webpack configuration was:', webpackConfiguration)
  // }

  // fs.unlinkSync(webpackConfigPath);

  return { outputDir };
};

export const generateWebpackConfig = ({
  pluginsPaths,
  entryFullPath, // set it to code fullPath
  outputDir, // set it to whatever you want programmatically
  modulesToIgnore, // we don't use it, skip it
}: {
  pluginsPaths: PluginsPaths;
  entryFullPath: string;
  outputDir: string;
  modulesToIgnore?: string[];
}) => {
  const nodeModulesList = getListOfNodeModules();

  const moduleReplacementPluginSection = () => {
    if (modulesToIgnore && modulesToIgnore.length) {
      return `new webpack.NormalModuleReplacementPlugin(
          /${modulesToIgnore.join("|")}/,
          "${pluginsPaths.noop2}",
        ),`;
    }
    return "";
  };

  return `
    const { builtinModules } = require("module");
    const webpack = require("${pluginsPaths.webpack}");
    const TsconfigPathsPlugin = require('${
      pluginsPaths["tsconfig-paths-webpack-plugin"]
    }')
    const TerserPlugin = require('${pluginsPaths["terser-webpack-plugin"]}')


    module.exports = {
      mode: "production",
      entry: "${entryFullPath}",
      target: "node",
      stats: 'errors-only',
      resolve: {
        // we need to iterate over all packages and add the node_modules dynamically
        // modules: ["../../node_modules", ${nodeModulesList}],
        extensions: [ '.mjs', '.ts', '.js' ],
        plugins: [new TsconfigPathsPlugin({configFile: '../../tsconfig.json'})],
      },
      optimization: {
        nodeEnv: 'production',
        minimize: true,
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              ecma: undefined,
              parse: {},
              compress: {},
              mangle: false,
              module: false,
              output: null,
              toplevel: false,
              nameCache: null,
              ie8: false,
              keep_classnames: true,
              keep_fnames: true,
              safari10: false,
            },
          }),
        ],
      },
      devtool: "source-map",
      module: {
        rules: [
      {
        test: /\\.m?js/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {onlyCompileBundledFiles: true, transpileOnly: true},
          },
        ],
        exclude: /node_modules/,
      },
        ]
      },
      externals: [...builtinModules, "aws-sdk"],
      output: {
        filename: "[name].js",
        path: "${outputDir}",
        libraryTarget: "commonjs2",
      },
      ${
        (modulesToIgnore &&
          `
      plugins: [
       ${moduleReplacementPluginSection()}
      ],
      `) ||
        ""
      }
    };`;
};

type PluginsPaths = { [key: string]: string };

const createPluginsPaths = () =>
  [
    "webpack",
    "noop2",
    "tsconfig-paths-webpack-plugin",
    "terser-webpack-plugin",
  ].reduce(
    (acc, pluginName) => ({
      [pluginName]: path.dirname(
        findUp.sync("package.json", {
          cwd: path.dirname(require.resolve(pluginName)),
        }) as string
      ),
      ...acc,
    }),
    {}
  ) as PluginsPaths;

const getListOfNodeModules = () => {
  // TODO get the list from lerna.json instead
  return shelljs
    .ls("../")
    .map((s: any) => {
      const exist = shelljs.test("-d", `../${s}/node_modules`);
      if (exist && s !== "cdk") {
        return `"../${s}/node_modules"`;
      }
      return null;
    })
    .filter((a) => a)
    .join(",");
};
/**
 * Properties for a NodejsFunction
 */
export interface NodejsFunctionProps extends lambda.FunctionOptions {
  addDependencies?: ((self: TypeScriptFunction) => void)[];
  /**
   * Path to the entry file (JavaScript or TypeScript), relative to your project root
   */
  readonly entry: string;

  /**
   * The name of the exported handler in the entry file.
   *
   * @default "handler"
   */
  readonly handler?: string;

  /**
   * The runtime environment. Only runtimes of the Node.js family are
   * supported.
   *
   * @default - `NODEJS_12_X` if `process.versions.node` >= '12.0.0',
   * `NODEJS_10_X` otherwise.
   */
  readonly runtime?: lambda.Runtime;

  /**
   * If you get "Module not found: Error: Can't resolve 'module_name'" errors, and you're not
   * actually using those modules, then it means there's a module you're using that is trying to
   * dynamically require other modules. This is the case with Knex.js. When this happens, pass all the modules
   * names found in the build error in this array.
   *
   * Example if you're only using PostgreSQL with Knex.js, use:
   *  `modulesToIgnore: ["mssql", "pg-native", "pg-query-stream", "tedious"]`
   */
  readonly modulesToIgnore?: string[];

  /**
   * Whether to automatically reuse TCP connections when working with the AWS
   * SDK for JavaScript.
   *
   * This sets the `AWS_NODEJS_CONNECTION_REUSE_ENABLED` environment variable
   * to `1`.
   *
   * @see https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/node-reusing-connections.html
   *
   * @default true
   */
  readonly awsSdkConnectionReuse?: boolean;

  readonly logFunction?: lambda.Function;

  readonly withHttp?: boolean;
}

/**
 * A Node.js Lambda function bundled using Parcel
 */
export class TypeScriptFunction extends lambda.Function {
  public url?: string;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: NodejsFunctionProps = {
      entry: "",
      modulesToIgnore: [],
      withHttp: false,
    }
  ) {
    if (props.runtime && props.runtime.family !== lambda.RuntimeFamily.NODEJS) {
      throw new Error("Only `NODEJS` runtimes are supported.");
    }

    if (!/\.(js|ts)$/.test(props.entry)) {
      throw new Error(
        "Only JavaScript or TypeScript entry files are supported."
      );
    }

    const entryFullPath = path.resolve(props.entry);

    if (!fs.existsSync(entryFullPath)) {
      throw new Error(`Cannot find entry file at ${entryFullPath}`);
    }

    const { outputDir } = compileCode({
      modulesToIgnore: props.modulesToIgnore,
      entryFullPath,
    }) as { outputDir: string };

    // this is incorrectly typed in shelljs, the array returns an object
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const compiledFiles = shelljs.ls("-l", outputDir).map((a) => a.name);
    if (compiledFiles.length === 0) {
      console.error(
        `No files compiled for: ${entryFullPath}. Something probably went wrong.`
      );
    }

    const defaultRunTime =
      nodeMajorVersion() >= 12
        ? lambda.Runtime.NODEJS_12_X
        : lambda.Runtime.NODEJS_10_X;
    const runtime = props.runtime ?? defaultRunTime;

    const handler = props.handler ?? "handler";

    super(scope, id, {
      ...props,
      runtime,
      code: lambda.Code.fromAsset(outputDir),
      handler: `main.${handler}`,
    });

    new CfnOutput(scope, `${id}UploadInfoExtended`, {
      value: JSON.stringify({ entryFullPath, functionName: this.functionName }),
      condition: new CfnCondition(scope, `${id}testEnvCondition`, {
        expression: Fn.conditionEquals(process.env.NODE_ENV || "", "test"),
      }),
    });

    if (props.logFunction) {
      new SubscriptionFilter(scope, `${id}Subscription`, {
        logGroup: this.logGroup,
        filterPattern: FilterPattern.anyTerm("ERROR"),
        destination: new LogsDestinations.LambdaDestination(props.logFunction),
      });
    }

    if (props.withHttp) {
      const api = new apiGateway2.HttpApi(scope, `${id}HttpApi`, {
        defaultIntegration: new apiGateway2Integrations.LambdaProxyIntegration({
          handler: this,
        }),
      });

      this.url = api.url as string;

      new CfnOutput(scope, `${id}Url`, {
        value: this.url,
      });
    }

    //
    // Enable connection reuse for aws-sdk
    if (props.awsSdkConnectionReuse ?? true) {
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1");
    }

    if (props.addDependencies) {
      functionsToRunAfter = [
        ...functionsToRunAfter,
        ...props.addDependencies.map((dependencyFunction) => () =>
          dependencyFunction(this)
        ),
      ];
    }

    this.addEnvironment("NODE_OPTIONS", "--enable-source-maps");
  }
}

function nodeMajorVersion(): number {
  return parseInt(process.versions.node.split(".")[0], 10);
}

export const initializeToolkitDependencies = () => {
  functionsToRunAfter.forEach((f) => f());
};
