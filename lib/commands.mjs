// One function per command. Each returns { text, blocked } and prints nothing,
// so the CLI owns the terminal and the tests own everything else.
import { readFileSync } from "node:fs";
import { checkFiles } from "./rules.mjs";
import { checkMessage } from "./message.mjs";
import { checkPullRequest } from "./pr.mjs";
import { renderReport } from "./report.mjs";
import { applyBaseline, loadBaseline, refusedRecordings, staleEntries, writeBaseline } from "./baseline.mjs";
import { renderRules } from "./catalogue.mjs";
import { install } from "./install.mjs";
import { addedLines, allLinesOf, changedPaths, commitMessageFrom, diffFor, fileLineCount, trackedFiles } from "./git.mjs";

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|ico|svgz?|pdf|zip|gz|tgz|bz2|xz|woff2?|ttf|otf|eot|mp[34]|mov|wav|so|dylib|dll|exe|wasm|jar|class|bin|lock)$/i;

export class UsageError extends Error {}

function changeFindings(root, config, options) {
  const files = addedLines(diffFor({ root, range: options.range, staged: options.staged }));
  const fileLineCounts = {};
  if (options.staged) {
    for (const path of files.keys()) {
      fileLineCounts[path] = fileLineCount(path, root);
    }
  }
  return checkFiles(files, config, fileLineCounts);
}

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

export function runCheck(root, config, options) {
  const findings = changeFindings(root, config, options);
  if (!options.baseline) {
    return renderReport(findings, options);
  }
  const { kept, skipped } = applyBaseline(findings, loadBaseline(root));
  return renderReport(kept, options, skipped);
}

export function runMessage(root, config, options) {
  const source = options.target ?? ".git/COMMIT_EDITMSG";
  const text = source === "HEAD" ? commitMessageFrom("HEAD", root) : readFileSync(source, "utf8");
  return renderReport(checkMessage(text, config.message), options);
}

export function runPullRequest(root, config, options) {
  if (!options.body) {
    throw new UsageError("say where the body is: commit-gate pr --body pr.md");
  }
  const body = readFileSync(options.body, "utf8");
  const commitBody = commitMessageFrom("HEAD", root) ?? "";
  return renderReport(checkPullRequest(body, config.pr, commitBody), options);
}

export function runBaseline(root, config, options) {
  if (options.range) {
    throw new UsageError("baseline scans the whole tree, so --range does not apply.");
  }
  const wholeTree = wholeTreeFindings(root, config);
  const refused = refusedRecordings(wholeTree, changedPaths(diffFor({ root, staged: true })));
  if (refused.length > 0) {
    return {
      blocked: true,
      text: [
        "commit-gate: refusing to record findings in files this change touches:",
        ...refused.map((key) => `  ${key.replace("::", "  ")}`),
        "",
        "Fix them, or suppress one with a reason so the exception is reviewed.",
      ].join("\n"),
    };
  }
  const stale = staleEntries(loadBaseline(root), wholeTree);
  const accepted = writeBaseline(root, wholeTree);
  const lines = [`commit-gate: recorded ${accepted} accepted finding${accepted === 1 ? "" : "s"}.`];
  if (stale.length > 0) {
    lines.push(`Dropped ${stale.length} entr${stale.length === 1 ? "y" : "ies"} nothing violates any more.`);
  }
  lines.push("New findings block from now on. Shrink this file as you clean up.");
  return { text: lines.join("\n"), blocked: false };
}

export function runInstall(root, options) {
  const lines = install(root, { force: options.force }).map((result) => {
    const status = result.written ? "wrote" : `skipped (${result.reason})`;
    return `  ${status}  ${result.path}`;
  });
  lines.push("", "Hooks run on commit. Agents: see the section added to CLAUDE.md or AGENTS.md.");
  return { text: lines.join("\n"), blocked: false };
}

export function runRules() {
  return { text: renderRules(), blocked: false };
}
