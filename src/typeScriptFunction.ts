/* eslint-disable no-new */
import * as fs from "fs";
import * as path from "path";
import * as process from "process";

import * as lambda from "@aws-cdk/aws-lambda";
import * as cdk from "@aws-cdk/core";
import { FilterPattern, SubscriptionFilter } from "@aws-cdk/aws-logs";
import { CfnCondition, CfnOutput, Fn } from "@aws-cdk/core";
import * as LogsDestinations from "@aws-cdk/aws-logs-destinations";
import * as apiGateway2 from "@aws-cdk/aws-apigatewayv2";
import * as apiGateway2Integrations from "@aws-cdk/aws-apigatewayv2-integrations";

import { compileCodeEsbuild } from "./compileCodeEsbuild";

let functionsToRunAfter: (() => void)[] = [];

export const compileCode = compileCodeEsbuild;

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

    const defaultRunTime =
      nodeMajorVersion() >= 12
        ? lambda.Runtime.NODEJS_14_X
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
