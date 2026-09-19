#!/usr/bin/env node
// commit-gate — check a change against a project's standards before it lands,
// and tell an agent what is left to judge for itself.
//
// Full docs: README.md

import { readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { HELP } from "../lib/help.mjs";
import { addedLines, commitMessageFrom, diffFor, fileLineCount, GitError, repositoryRoot } from "../lib/git.mjs";
import { checkFiles, SEVERITY } from "../lib/rules.mjs";
import { checkMessage } from "../lib/message.mjs";
import { checkPullRequest } from "../lib/pr.mjs";
import { countBySeverity, renderForAgent, renderJson, renderText } from "../lib/report.mjs";
import { applyBaseline, loadBaseline, writeBaseline } from "../lib/baseline.mjs";
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

function report(findings, options, baselineSkipped = 0) {
  if (options.json) {
    console.log(renderJson(findings, { strict: options.strict, baselineSkipped }));
  } else if (options.agent) {
    console.log(renderForAgent(findings));
  } else {
    console.log(renderText(findings, { strict: options.strict }));
    if (baselineSkipped > 0) {
      console.log(`(${baselineSkipped} pre-existing finding${baselineSkipped === 1 ? "" : "s"} accepted by the baseline)`);
    }
  }
  const { errors, warnings } = countBySeverity(findings);
  if (errors > 0 || (options.strict && warnings > 0)) {
    process.exit(EXIT.blocked);
  }
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

function runCheck(root, config, options) {
  const findings = changeFindings(root, config, options);
  if (!options.baseline) {
    report(findings, options);
    return;
  }
  const { kept, skipped } = applyBaseline(findings, loadBaseline(root));
  report(kept, options, skipped);
}

function runMessage(root, config, options) {
  const source = options.target ?? ".git/COMMIT_EDITMSG";
  const text = source === "HEAD" ? commitMessageFrom("HEAD", root) : readFileSync(source, "utf8");
  report(checkMessage(text, config.message), options);
}

function runPullRequest(root, config, options) {
  if (!options.body) {
    fail("say where the body is: commit-gate pr --body pr.md");
  }
  const body = readFileSync(options.body, "utf8");
  const commitBody = commitMessageFrom("HEAD", root) ?? "";
  report(checkPullRequest(body, config.pr, commitBody), options);
}

function runBaseline(root, config, options) {
  const findings = changeFindings(root, config, { ...options, range: options.range ?? "HEAD" });
  const accepted = writeBaseline(root, findings);
  console.log(`commit-gate: recorded ${accepted} accepted finding${accepted === 1 ? "" : "s"}.`);
  console.log("New findings will block from now on. Shrink this file as you clean up.");
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
    fail(error instanceof GitError ? error.message : error.message);
  }
}

main();
