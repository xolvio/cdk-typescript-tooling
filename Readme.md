# cdk-typescript-tooling

AWS is great.
Lambdas changed the way we think about programming. 
CDK makes it all even better.

But working with these technologies we've encountered some pain points, and in this package wanted to address two of them. First is streamlining build of TypeScript code, and the second is the slow development feedback loop with code changes.

## CDK TypeScript resource

### Why?
All-typescript codebase including infrastructure as a code with CDK and application code is a pleasure to use.
Deployment of it, not so much. 

You can transpile your code to a new directory, copy package.json there, install production dependencies, and then have CDK send that whole folder to lambda. It's painful to setup, and it will bring a ton of unnecessary code (everything in node_modules) along. 
Webpack is better - it can take an entrypoint and create a small bundled file that includes only what you need.
Unfortunately, no one likes to setup complex and diversing webpack configurations, especially in a monorepo with tens if not hundred of tiny packages. 

### What?
We wanted TypeScript Lambda experience to be seemless - if a developer wants to create a new function, he should create a typescript file, add it to CDK and that's it. Now you can do it like so:

```typescript
import {TypeScriptFunction} from 'cdk-typescript-tooling'

const statusHandle = new TypeScriptFunction(  
  scope,  
  "Purchase-Status-Endpoint",  
  {  
	  entry: require.resolve("@sales/purchase-endpoint/src/handler.ts"),
  }  
);
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
import * as cdk from "@aws-cdk/core"
import { SalesSystem } from "./SalesSystem"
  
const baseStackName = "SalesSystemExample"
export default new SalesSystem(new cdk.App(), baseStackName)
```

If you need to do something async before returning a stack, a pattern like this should work:

```typescript
export default (async () => {  
  const stackSuffix = await getStackSuffix(baseStackName)  
  return new SalesSystem(new cdk.App(), `${baseStackName}${stackSuffix}`)  
})()
```

> We like to deploy a stack per branch, so all our branches have different StackNames and also differently named (suffixed) resources. Because of that we rely on branch name to cache your stack information. Worst case scenario you will have cache built multiple times with the same data. 


####  Updating single function:
The compilation and uploading of functions happen in parallel. Because of that it is crazy fast (<10 s for ~20 functions) and in most cases that is what you should be doing. It comes with the advantage that if you change a code that's used by a few different functions, all of them will be redeployed. Sometimes you might not realize that some piece of code is used in multiple places and get yourself in some weird inconsistent state.
But if you must, or if you have hundreds of functions in the stack, it's simple, get the physicalId of a function (using aws cli or going to the stack using their cloudformation panel), and do:

```
npx update-typescript-function ./src/cdk.ts SalesSystemExample-PurchaseEndpoint321B1702-IKYULFRNR9VJ
```

Enjoy!


## State of the project
This is a Proof Of Concept. It works for us, and you can play around with it using this Demo Repo: [xolvio/aws-sales/system-example](https://github.com/xolvio/aws-sales-system-example/tree/async-invocation)  
Please let us know if you hit any problems.
Please do NOT use the updater for updating your production code. That should be a no-go even after this project becomes battle-tested.
