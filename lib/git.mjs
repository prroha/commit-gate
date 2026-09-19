// Reading what is about to be committed.
import { execFileSync } from "node:child_process";

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export class GitError extends Error {}

function git(args, cwd) {
  try {
    // stderr is captured, not inherited: a probe that misses must not print
    // git's own fatal line to the user's terminal.
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  // Without the separator git reads an unresolvable range as a path and says so
  // in its own terms; with it, an unknown revision is reported as one.
  args.push("--");
  return git(args, root);
}

// Only lines this change adds are judged, so a legacy file does not fail a
// one-line fix inside it.
export function changedPaths(diff) {
  return [...addedLines(diff).keys()];
}

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
    return toLines(git(["show", `:${path}`], root)).length;
  } catch {
    return null;
  }
}

// -z, because git C-quotes any path with non-ASCII or control characters and a
// quoted path resolves to nothing.
export function trackedFiles(root) {
  return git(["ls-files", "-z"], root).split("\0").filter(Boolean);
}

// A baseline records what exists today, so it reads whole files rather than a
// diff: every line counts as present, not as added by this change. The index
// comes first, so a file staged but never committed is still scanned.
export function allLinesOf(path, root) {
  for (const revision of [`:${path}`, `HEAD:${path}`]) {
    try {
      return toLines(git(["show", revision], root));
    } catch (error) {
      // A path absent from this revision is expected; anything else is not.
      if (!/does not exist|exists on disk|unknown revision|Not a valid object/i.test(error.message)) {
        throw error;
      }
    }
  }
  return [];
}

function toLines(contents) {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.map((text, index) => ({ line: index + 1, text }));
}

export function commitMessageFrom(source, root) {
  if (source === "HEAD") {
    return git(["log", "-1", "--format=%B"], root);
  }
  return null;
}
