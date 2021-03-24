import type * as dynamodb from "@aws-cdk/aws-dynamodb";
import { TypeScriptFunction } from "./typeScriptFunction";

const tables: { [key: string]: dynamodb.ITable } = {};
const lambdas: { [key: string]: TypeScriptFunction } = {};

export const registerTable = (tableName: number, table: dynamodb.ITable) => {
  tables[AvailableTables[tableName]] = table;
};

export const registerLambda = (
  lambdaName: number,
  lambdaHandler: TypeScriptFunction
) => {
  lambdas[AvailableLambdas[lambdaName]] = lambdaHandler;
};

let AvailableLambdas: { [key: number]: string };
let AvailableTables: { [key: number]: string };

export default <L, T>(
  availableLambdas: {
    [key: number]: string;
  },
  availableTables: { [key: number]: string }
) => {
  const addLambdas = (...lambdaNames: L[]) => (handle: TypeScriptFunction) => {
    lambdaNames.forEach((lambdaName) => {
      const lambda = lambdas[
        AvailableLambdas[(lambdaName as unknown) as number]
      ] as TypeScriptFunction;

      handle.addEnvironment(
        `LAMBDA_${AvailableLambdas[(lambdaName as unknown) as number]}`,
        lambda.functionName
      );
      if (lambda.url) {
        handle.addEnvironment(
          `LAMBDA_${AvailableLambdas[(lambdaName as unknown) as number]}_URL`,
          lambda.url
        );
      }
      lambda.grantInvoke(handle);
    });
  };

  const addTables = (...tableNames: T[]) => (handle: TypeScriptFunction) => {
    tableNames.forEach((tableName) => {
      const table = tables[
        AvailableTables[(tableName as unknown) as number]
      ] as dynamodb.ITable;

      handle.addEnvironment(
        `DYNAMODB_${AvailableTables[(tableName as unknown) as number]}`,
        table.tableName
      );
      table.grantReadWriteData(handle);
    });
  };

  AvailableLambdas = availableLambdas;
  AvailableTables = availableTables;
  return {
    addLambdas,
    addTables,
    TypeScriptFunctionWithLambdas: class TypeScriptFunctionWithLambdas extends TypeScriptFunction {
      constructor(
        scope: ConstructorParameters<typeof TypeScriptFunction>[0],
        id: L,
        props: ConstructorParameters<typeof TypeScriptFunction>[2]
      ) {
        const lambdaName = AvailableLambdas[(id as unknown) as number];

        super(scope, snakeToPascal(lambdaName), props);
        registerLambda((id as unknown) as number, this);
      }
    },
  };
};

const snakeToPascal = (name: string) =>
  name
    .split("_")
    .map(
      (str) =>
        str.slice(0, 1).toUpperCase() + str.slice(1, str.length).toLowerCase()
    )
    .join("");
