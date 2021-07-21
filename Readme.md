# cdk-typescript-tooling

AWS is great.
Lambdas changed the way we think about programming.
CDK makes it all even better.

Nonetheless, working with these technologies we've encountered some pain points. We want to address a few of them in this package.

- streamlining build of TypeScript code
- speeding up the development feedback loop with lambda updates
- streamlined/shared error logging
- "smart defaults" for exposing lambdas through http
- Lambda and DynamoDB tables dependency management

## CDK TypeScript resource

### Why?

All-typescript codebase including infrastructure as a code with CDK and application code is a pleasure to use.
Deployment of it, not so much.

You can transpile your code to a new directory, copy package.json there, install production dependencies, and then have CDK send that whole folder to lambda. It's painful to set up, and it will bring a ton of unnecessary code (everything in node_modules) along.
Webpack is better - it can take an entrypoint and create a small bundled file that includes only what you need.
Unfortunately, no one likes to set up complex and diverging webpack configurations, especially in a monorepo with tens if not hundreds of tiny packages.

### What?

We wanted TypeScript Lambda experience to be seamless - if a developer wants to create a new function, he should create a typescript file, add it to CDK and that's it. Now you can do it like so:

```typescript
import { TypeScriptFunction } from "cdk-typescript-tooling";
// ...
const statusHandle = new TypeScriptFunction(scope, "Purchase-Status-Endpoint", {
  entry: require.resolve("@sales/purchase-endpoint/src/handler.ts"),
});
```

It takes all the parameters that you know from [@aws-cdk/aws-lambda](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-lambda-readme.html), like `runtime`, `environment`, `timeout`, and so on, because we extend it.

## Instant updates (development)

### Why?

Deploying the whole stack everytime when you want to check your changes is tiresome and boring.
If you do it by pushing to CI system - it's even slower.
If you do it locally, it's still slow. And if your build relies on multiple secrets (like most do), you can't even do it properly from your local dev.
Changing files in-line through lambda panel is painful - you can't paste TypeScript code because that will result in Syntax Errors. You also risk forgetting about some changes in the code, and later losing them after the next push, or - even worse - QAing and approving the functionality and merging to master, even though the code in repository does not have the required fix. It's a mess :)

### What?

Using the TypeScriptFunction from our tool gives you the ability to use `update-typescript-function` command.

#### Updating all functions:

Assuming your stack is declared at `./src/cdk.ts` Run it like this:

```
npx update-typescript-function ./src/cdk.ts
```

And it will quickly and automatically update all TypeScript Lambda functions found in your CDK Stack.

#### Configuration:

Actually, you might need to do a few exports first... ;-)

```
export AWS_SECRET_ACCESS_KEY=SECRET_ACCESS_KEY
export AWS_ACCESS_KEY_ID=ACCESS_KEY
export AWS_REGION=us-east-2
```

In the future we do want to read those from ~/.aws/credentials, but for now please export the values.

We need your cdk file to export a stack, in most cases you will do something like this:

```typescript
import * as cdk from "@aws-cdk/core";
import { SalesSystem } from "./SalesSystem";

const baseStackName = "SalesSystemExample";
export default new SalesSystem(new cdk.App(), baseStackName);
```

If you need to do something async before returning a stack, a pattern like this should work:

```typescript
export default (async () => {
  const stackSuffix = await getStackSuffix(baseStackName);
  return new SalesSystem(new cdk.App(), `${baseStackName}${stackSuffix}`);
})();
```

> We like to deploy a stack per branch, so all our branches have different StackNames and also differently named (suffixed) resources. Because of that we rely on branch name to cache your stack information. Worst case scenario you will have cache built multiple times with the same data.

#### Updating single function:

The compilation and uploading of functions happen in parallel. Because of that it is crazy fast (<10 s for ~20 functions) and in most cases that is what you should be doing. It comes with the advantage that if you change a code that's used by a few different functions, all of them will be redeployed. Sometimes you might not realize that some piece of code is used in multiple places and get yourself in some weird inconsistent state.
But if you must, or if you have hundreds of functions in the stack, it's simple, get the Logical ID of a function (using aws cli or going to the stack using their cloudformation panel), and do:

```
npx update-typescript-function ./src/cdk.ts PurchaseEndpointIKYULFRNR9VJ
```

## Error logging

### Why?

Having multiple independent lambda functions is great, but it comes with a price of difficult monitoring.
We like to be notified of things going wrong, as early as possible and in automated fashion. New lambda functions should be connected to the system with a minimal setup.

### What?

Our TypeScriptFunction has built-in ability to send Error logs to a passed lambda handler.
First, create a logHandler:

```typescript
import { CloudWatchLogsDecodedData, CloudWatchLogsHandler } from "aws-lambda";
import zlib from "zlib";

export const handler: CloudWatchLogsHandler = async (event, context) => {
  const compressedPayload = Buffer.from(event.awslogs.data, "base64");
  const jsonPayload = zlib.gunzipSync(compressedPayload).toString("utf8");
  const parsed: CloudWatchLogsDecodedData = JSON.parse(jsonPayload);
  console.log(parsed);
};
```

This is the simplest possible one that will just log errors in a CloudWatch stream aggregating all errors from all lambda functions.

Now in your cdk define a TypeScriptFunction that will deploy that code. Assign its handle to a variable.

```typescript
import { SubscriptionFilter, FilterPattern } from "@aws-cdk/aws-logs";
import * as LogsDestinations from "@aws-cdk/aws-logs-destinations";
//...
const logHandle = new TypeScriptFunction(scope, "logHandler", {
  entry: require.resolve("@sales/logHandler/src/handler.ts"),
});
```

Pass it to existing function like so:

```typescript
new TypeScriptFunction(scope, "Purchase-Status-Endpoint", {
  entry: require.resolve("@sales/purchase-endpoint/src/handler.ts"),
  logFunction: logHandle,
});
```

Now, whenever any error (console.error or exception) shows up in the Purchase-Status-Endpoint, it will be passed and displayed by the logHandler.
Obviously, the usefulness of that increases with the number of lambdas you have. :-)

Enjoy!

## Easily expose through HTTP

### Why?

In our development exposing lambdas with http is a very frequent case. The code around it for most cases stays exactly the same and increases the noise.
We define the function:

```typescript
const handler = new TypeScriptFunction(stack, "Add-Function", {
  entry: require.resolve("@calculator/add/src/handler.ts"),
});
```

Add HttpApi using LambdaProxyIntegration

```typescript
const statusApi = new apiGateway2.HttpApi(stack, "PurchaseStatusHttpApi", {
  defaultIntegration: new apiGateway2Integrations.LambdaProxyIntegration({
    handler,
  }),
});
```

Add the url to CfnOutput to, among others, see the url in CI/CD logs.

```typescript
new CfnOutput(stack, "addUrl", {
  value: statusApi.url,
});
```

### What?

Define your function with `withHttp` option like so:

```typescript
new TypeScriptFunction(stack, "Add-Function", {
  entry: require.resolve("@calculator/add/src/handler.ts"),
  withHttp: true,
});
```

...and the other two steps will be done for you automatically.

## Lambda and DynamoDB tables dependency management

### Why?

Managing dependencies between Lambdas and DynamoDB tables can get ugly.
The default way of allowing a Lambda function to access DynamoDB is done like so:

```typescript
const tableHandle = new dynamodb.Table(stack, "Table", {
  partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
});

const functionHandle = new TypeScriptFunction(stack, "Add-Function", {
  entry: require.resolve("@calculator/add/src/handler.ts"),
  environment: {
    TABLE_NAME: tableHandle.tableName, // adding the table name to the environment
  },
});

tableHandle.grantReadWriteData(functionHandle); // grant the lambda access
```

And then in your code you'd do:

```typescript
await this.documentClient
  .scan({ TableName: process.env.TABIE_NAME }) // using the env variable from lambda definition
  .promise();
```

As you probably already know this pattern comes with some potential issues.

1. First is the problematic usage in code - there is no way to match that the environment variables name set on the function
   match what you are trying to access from the code. (I actually did put a typo there, did you spot it?)
   Although there are things to mitigate this a bit, for example - never use the env variables directly, but have centralized functions that do that, like:

```typescript
const getTableName = () => process.env.TABLE_NAME;
```

Still, no verification is happening, and if someone removes the environment variable or change its name, you won't be able to know until you get a runtime error.

2. Another problem is the need to pass handlers around. For small stacks that might actually have only one function and one table, that's non-issue, but if you have a large application with tens or even hundreds of lambdas, and multiple tables, it gets ugly.

3. Related to number 2 - since you have to pass things around, they have to be introduced in order. Let's say we want to add a lambda that will watch the stream of events in that table, and maybe create some cache or aggregation in another table. It will have to be declared after the initial table. Then let's have another function that reads from that cache. It might seem like that order is correct, and if you are happy to keep things that way - great! Nonetheless - you should not be forced to. Sometimes it might make more sense to group and order things by functionality, not by their dependency order.

4. You have to remember to grant the permissions to read the Table to the lambda function. It seems like a sensible thing to do, but when you think about it - it wouldn't make sense to add the environment variable if we didn't also grant the permissions. Similarly - it would not make sense to grant permissions if we didn't somehow expose information to the lambda about how to connect to the table. That means - we should be able to do this in one step. (again, a frequent source of errors that are only visible run-time)

5. Handlers are only typed as a generic CDK Lambda/DynamoDB Table. That means, if you need to pass many of them around there is no way to see a problem before, again, a run-time error.
   Consider a lambda function that requires access to multiple tables:

```typescript
const createTablesAggregator = (
  stack: Stack,
  someTable: ITable,
  otherTable: ITable,
  yetAnotherTable: ITable
) => {
  new TypeScriptFunction(stack, "Aggregator-Function", {
    entry: require.resolve("@calculator/aggregator/handler.ts"),
    environment: {
      SOME_TABLE: someTable.tableName,
      OTHER_TABLE: otherTable.tableName,
      YET_ANOTHER_TABLE: yetAnotherTable.tableName,
    },
  });
};
```

and then somewhere else you would call:

```typescript
createTablesAggregator(stack, someTable, yetAnotherTable, otherTable);
```

TypeScript would have no way of catching this mistake - everything would deploy. Best case scenario things would not work, worst case scenario, you might mess up the tables that were passed in a wrong order (maybe the schema for the tables was compatible, and your code successfully did an operation that should happen in the other table). Again - for a small stack this might seem like a non-issue. However, once you have a large one, and multiple people change the CDK code at the same time, it's very easy to mess this up.

### What?

By now you are hopefully convinced that there are areas for improvements. Our solution is based on having a central "registry" for Lambdas and Dynamo Tables.

Registry allows you to later reference those constructs by names, instead of passing them around. (which takes care of problems 2, 3, 5).

```typescript
registerTable(stack, AvailableTables.TABLE, {
  partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
}); // registerTable is a custom wrapper, trivial to implement yourself, see example below

new ToolkitFunction(stack, AvailableLambdas.ADD, {
  entry: require.resolve("@calculator/add/src/handler.ts"),
  addDependencies: [addTables(AvailableTables.TABLE)],
});
```

Using the addDependencies automatically adds the permissions (RW by default, trivial to add an option to specify a more limited permission) - which takes care of the problem number 4.

We are left with the problem number 1, which is solved by using a helper function in your code:

```typescript
export const getDynamoTableName = (tableName: AvailableTables) =>
        process.env[`DYNAMODB_${AvailableTables[tableName]}`]

getDynamoTableName(AvailableTables.TABLE)
```

To see how this all connects together take a look at dependencyManagement branch of our [xolvio/aws-sales-system-example/dependencyManagement]
(https://github.com/xolvio/aws-sales-system-example/tree/dependencyManagement)

## State of the project

This is a Proof Of Concept. It works for us, and you can play around with it using this Demo Repo: [xolvio/aws-sales-system-example](https://github.com/xolvio/aws-sales-system-example/tree/async-invocation)  
Please let us know if you hit any problems.
Please do NOT use the updater for updating your production code. That should be a no-go even after this project becomes battle-tested.
