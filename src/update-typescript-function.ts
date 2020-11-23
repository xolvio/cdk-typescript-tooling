#!/usr/bin/env node
import * as shelljs from "shelljs";

const command = `ts-node ${__dirname}/runUpdateTypeScriptFunction.js ${process.argv
  .slice(2)
  .join(" ")}`;
shelljs.exec(command);
