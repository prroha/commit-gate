#!/usr/bin/env node
// commit-gate — check a change against a project's standards before it lands,
// and tell an agent what is left to judge for itself.
//
// This file owns the terminal: the command functions are pure and return text.
//
// Full docs: README.md

import { readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { HELP } from "../lib/help.mjs";
import { GitError, repositoryRoot } from "../lib/git.mjs";
import {
  runBaseline,
  runCheck,
  runInstall,
  runMessage,
  runPullRequest,
  runRules,
  UsageError,
} from "../lib/commands.mjs";

const EXIT = { ok: 0, blocked: 1, usage: 2, noRepository: 3 };

function parseArguments(argv) {
  const options = {
    command: "check",
    target: null,
    staged: false,
    range: null,
    strict: false,
    json: false,
    agent: false,
    baseline: true,
    body: null,
    dir: process.cwd(),
    force: false,
    help: false,
    version: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next == null || next.startsWith("--")) {
        throw new UsageError(`${argument} needs a value`);
      }
      return next;
    };
    switch (argument) {
      case "--staged": options.staged = true; break;
      case "--strict": options.strict = true; break;
      case "--json": options.json = true; break;
      case "--agent": options.agent = true; break;
      case "--no-baseline": options.baseline = false; break;
      case "--force": options.force = true; break;
      case "--range": options.range = value(); break;
      case "--body": options.body = value(); break;
      case "--dir": options.dir = value(); break;
      case "-h": case "--help": options.help = true; break;
      case "-v": case "--version": options.version = true; break;
      default:
        if (argument.startsWith("-")) {
          throw new UsageError(`unknown option: ${argument}`);
        }
        positional.push(argument);
    }
  }
  if (positional.length > 0) {
    options.command = positional[0];
    options.target = positional[1] ?? null;
  }
  return options;
}

function fail(message, code = EXIT.usage) {
  console.error(`commit-gate: ${message}`);
  process.exit(code);
}

function readVersion() {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

const COMMANDS = {
  check: runCheck,
  message: runMessage,
  pr: runPullRequest,
  baseline: runBaseline,
  install: (root, config, options) => runInstall(root, options),
};

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
  }

  if (options.version) {
    console.log(readVersion());
    return;
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  // A static catalogue needs no repository to read.
  if (options.command === "rules") {
    console.log(runRules().text);
    return;
  }
  if (!Object.hasOwn(COMMANDS, options.command)) {
    fail(`unknown command: ${options.command}. Run commit-gate --help.`);
  }

  let root;
  try {
    root = repositoryRoot(options.dir);
  } catch {
    fail(`${options.dir} is not inside a git repository.`, EXIT.noRepository);
  }

  try {
    const { text, blocked } = COMMANDS[options.command](root, loadConfig(root).config, options);
    console.log(text);
    process.exitCode = blocked ? EXIT.blocked : EXIT.ok;
  } catch (error) {
    if (error instanceof UsageError) {
      fail(error.message);
    }
    if (error instanceof GitError && /unknown revision|bad revision/i.test(error.message)) {
      fail(`${options.range} does not resolve to a commit range in this repository.`);
    }
    fail(error.message);
  }
}

main();
