import * as dynamodb from "@aws-cdk/aws-dynamodb";
import * as awsLambda from "@aws-cdk/aws-lambda";
import {
  DynamoEventSourceProps,
  DynamoEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import { TypeScriptFunction } from "./typeScriptFunction";
import { snakeToPascal } from "./snakeToPascal";

type DynamoWithStream = {
  table: dynamodb.ITable;
  stream?: dynamodb.ITable;
};

export default <L extends number, T extends number>(
  AvailableLambdas: {
    [key: number]: string;
  },
  AvailableTables: { [key: number]: string }
) => {
  const tables: { [key in T]?: DynamoWithStream } = {};
  const lambdas: { [key in L]?: TypeScriptFunction } = {};

  const registerTable = (
    tableName: T,
    table: dynamodb.ITable,
    stream?: dynamodb.ITable
  ) => {
    tables[tableName] = { table, stream };
  };

  const registerLambda = (lambdaName: L, lambdaHandler: TypeScriptFunction) => {
    lambdas[lambdaName] = lambdaHandler;
  };

  const addLambdas = (...lambdaNames: L[]) => (handle: TypeScriptFunction) => {
    lambdaNames.forEach((lambdaName) => {
      const lambda = lambdas[lambdaName] as TypeScriptFunction;

      handle.addEnvironment(
        `LAMBDA_${AvailableLambdas[lambdaName]}`,
        lambda.functionName
      );
      if (lambda.url) {
        handle.addEnvironment(
          `LAMBDA_${AvailableLambdas[lambdaName]}_URL`,
          lambda.url
        );
      }
      lambda.grantInvoke(handle);
    });
  };

  const addTables = (...tableNames: T[]) => (handle: TypeScriptFunction) => {
    tableNames.forEach((tableName) => {
      const table = tables[tableName]!.table as dynamodb.ITable;

      handle.addEnvironment(
        `DYNAMODB_${AvailableTables[tableName]}`,
        table.tableName
      );
      table.grantReadWriteData(handle);
    });
  };

  const addStreams = (
    ...tableStreams: (T | { stream: T; streamOpts: DynamoEventSourceProps })[]
  ) => (handle: TypeScriptFunction) => {
    tableStreams.forEach((tableOrObject) => {
      if ("stream" in tableOrObject) {
        const table = tables[tableOrObject.stream]!.stream as dynamodb.ITable;
        const eventSource = new DynamoEventSource(
          table,
          tableOrObject.streamOpts
        );
        handle.addEventSource(eventSource);
      } else {
        const table = tables[tableOrObject]!.stream as dynamodb.ITable;
        const eventSource = new DynamoEventSource(table, {
          startingPosition: awsLambda.StartingPosition.TRIM_HORIZON,
          batchSize: 10,
          bisectBatchOnError: true,
          retryAttempts: 3,
        });
        handle.addEventSource(eventSource);
      }
    });
  };

  return {
    addLambdas,
    addTables,
    addStreams,
    registerTable,
    registerLambda,
    ToolkitFunction: class ToolkitFunction extends TypeScriptFunction {
      constructor(
        scope: ConstructorParameters<typeof TypeScriptFunction>[0],
        id: L,
        props: ConstructorParameters<typeof TypeScriptFunction>[2]
      ) {
        const lambdaName = AvailableLambdas[id];

        super(scope, snakeToPascal(lambdaName), props);
        registerLambda(id, this);
        return this as TypeScriptFunction;
      }
    },
  };
};
