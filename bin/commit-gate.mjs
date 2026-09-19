#!/usr/bin/env node
// commit-gate — check a change against a project's standards before it lands,
// and tell an agent what is left to judge for itself.
//
// Full docs: README.md

import { readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { HELP } from "../lib/help.mjs";
import { renderRules } from "../lib/catalogue.mjs";
import {
  addedLines,
  allLinesOf,
  changedPaths,
  commitMessageFrom,
  diffFor,
  fileLineCount,
  GitError,
  repositoryRoot,
  trackedFiles,
} from "../lib/git.mjs";
import { checkFiles, SEVERITY } from "../lib/rules.mjs";
import { checkMessage } from "../lib/message.mjs";
import { checkPullRequest } from "../lib/pr.mjs";
import { reportFindings } from "../lib/report.mjs";
import { applyBaseline, loadBaseline, refusedRecordings, staleEntries, writeBaseline } from "../lib/baseline.mjs";
import { install } from "../lib/install.mjs";

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
        throw new Error(`${argument} needs a value`);
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
          throw new Error(`unknown option: ${argument}`);
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

function changeFindings(root, config, options) {
  const diff = diffFor({ root, range: options.range, staged: options.staged });
  const files = addedLines(diff);
  const fileLineCounts = {};
  if (options.staged) {
    for (const path of files.keys()) {
      fileLineCounts[path] = fileLineCount(path, root);
    }
  }
  return checkFiles(files, config, fileLineCounts);
}

function reportAndExit(findings, options, baselineSkipped = 0) {
  if (reportFindings(findings, options, baselineSkipped)) {
    process.exit(EXIT.blocked);
  }
}

function runCheck(root, config, options) {
  const findings = changeFindings(root, config, options);
  if (!options.baseline) {
    reportAndExit(findings, options);
    return;
  }
  const { kept, skipped } = applyBaseline(findings, loadBaseline(root));
  reportAndExit(kept, options, skipped);
}

function runMessage(root, config, options) {
  const source = options.target ?? ".git/COMMIT_EDITMSG";
  const text = source === "HEAD" ? commitMessageFrom("HEAD", root) : readFileSync(source, "utf8");
  reportAndExit(checkMessage(text, config.message), options);
}

function runPullRequest(root, config, options) {
  if (!options.body) {
    fail("say where the body is: commit-gate pr --body pr.md");
  }
  const body = readFileSync(options.body, "utf8");
  const commitBody = commitMessageFrom("HEAD", root) ?? "";
  reportAndExit(checkPullRequest(body, config.pr, commitBody), options);
}

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|ico|svgz?|pdf|zip|gz|tgz|bz2|xz|woff2?|ttf|otf|eot|mp[34]|mov|wav|so|dylib|dll|exe|wasm|jar|class|bin|lock)$/i;

function wholeTreeFindings(root, config) {
  const files = new Map();
  const fileLineCounts = {};
  for (const path of trackedFiles(root)) {
    if (BINARY_EXTENSIONS.test(path)) {
      continue;
    }
    const lines = allLinesOf(path, root);
    files.set(path, lines);
    fileLineCounts[path] = lines.length;
  }
  return checkFiles(files, config, fileLineCounts);
}

function runBaseline(root, config, options) {
  if (options.range) {
    fail("baseline scans the whole tree, so --range does not apply.");
  }
  const wholeTree = wholeTreeFindings(root, config);
  const touched = changedPaths(diffFor({ root, staged: true }));
  const refused = refusedRecordings(wholeTree, touched);
  if (refused.length > 0) {
    console.error("commit-gate: refusing to record findings in files this change touches:");
    for (const key of refused) {
      console.error(`  ${key.replace("::", "  ")}`);
    }
    console.error("\nFix them, or suppress one with a reason so the exception is reviewed.");
    process.exit(EXIT.blocked);
  }
  const stale = staleEntries(loadBaseline(root), wholeTree);
  const accepted = writeBaseline(root, wholeTree);
  console.log(`commit-gate: recorded ${accepted} accepted finding${accepted === 1 ? "" : "s"}.`);
  if (stale.length > 0) {
    console.log(`Dropped ${stale.length} entr${stale.length === 1 ? "y" : "ies"} nothing violates any more.`);
  }
  console.log("New findings block from now on. Shrink this file as you clean up.");
}

function runInstall(root, options) {
  for (const result of install(root, { force: options.force })) {
    const status = result.written ? "wrote" : `skipped (${result.reason})`;
    console.log(`  ${status}  ${result.path}`);
  }
  console.log("\nHooks run on commit. Agents: see the section added to CLAUDE.md or AGENTS.md.");
}

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
  if (options.command === "rules") {
    console.log(renderRules());
    return;
  }

  let root;
  try {
    root = repositoryRoot(options.dir);
  } catch {
    fail(`${options.dir} is not inside a git repository.`, EXIT.noRepository);
  }

  const { config } = loadConfig(root);
  const commands = {
    check: () => runCheck(root, config, options),
    message: () => runMessage(root, config, options),
    pr: () => runPullRequest(root, config, options),
    baseline: () => runBaseline(root, config, options),
    install: () => runInstall(root, options),
  };
  const command = Object.hasOwn(commands, options.command) ? commands[options.command] : null;
  if (!command) {
    fail(`unknown command: ${options.command}. Run commit-gate --help.`);
  }
  try {
    command();
  } catch (error) {
    if (error instanceof GitError && /unknown revision|bad revision/i.test(error.message)) {
      fail(`${options.range} does not resolve to a commit range in this repository.`);
    }
    fail(error.message);
  }
}

main();
