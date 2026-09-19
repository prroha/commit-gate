// Reading what is about to be committed.
import { execFileSync } from "node:child_process";

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export class GitError extends Error {}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
  } catch (error) {
    throw new GitError(error.stderr?.trim() || error.message);
  }
}

export function repositoryRoot(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

export function diffFor({ root, range, staged }) {
  const args = ["diff", "--unified=0", "--no-color", "--diff-filter=ACMR"];
  if (range) {
    args.push(range);
  } else if (staged) {
    args.push("--cached");
  }
  return git(args, root);
}

// Only lines this change adds are judged, so a legacy file does not fail a
// one-line fix inside it.
export function addedLines(diff) {
  const files = new Map();
  let path = null;
  let lineNumber = 0;

  for (const line of diff.split("\n")) {
    const fileHeader = /^\+\+\+ b\/(.*)$/.exec(line);
    if (fileHeader) {
      path = fileHeader[1] === "/dev/null" ? null : fileHeader[1];
      if (path && !files.has(path)) {
        files.set(path, []);
      }
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (path && line.startsWith("+") && !line.startsWith("+++")) {
      files.get(path).push({ line: lineNumber, text: line.slice(1) });
      lineNumber += 1;
    }
  }
  return files;
}

export function fileLineCount(path, root) {
  try {
    return git(["show", `:${path}`], root).split("\n").length;
  } catch {
    return null;
  }
}

export function commitMessageFrom(source, root) {
  if (source === "HEAD") {
    return git(["log", "-1", "--format=%B"], root);
  }
  return null;
}
