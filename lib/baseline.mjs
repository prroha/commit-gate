// A baseline records what a repository already violates, so adopting the gate
// blocks new problems without demanding a weekend of cleanup first.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASELINE_FILE = "commit-gate-baseline.json";

// Keyed on rule and path, not line, so unrelated edits above a finding do not
// silently un-baseline it.
export function keyFor(finding) {
  return `${finding.rule}::${finding.path}`;
}

export function loadBaseline(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, BASELINE_FILE), "utf8"));
    return new Set(parsed.accepted ?? []);
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Set();
    }
    throw new Error(`${BASELINE_FILE} is not valid JSON: ${error.message}`);
  }
}

export function writeBaseline(root, findings) {
  const accepted = [...new Set(findings.map(keyFor))].sort();
  writeFileSync(
    join(root, BASELINE_FILE),
    `${JSON.stringify({ accepted }, null, 2)}\n`,
  );
  return accepted.length;
}

export function applyBaseline(findings, baseline) {
  const kept = findings.filter((finding) => !baseline.has(keyFor(finding)));
  return { kept, skipped: findings.length - kept.length };
}

// Recording a finding in a file the current change touches would bury the very
// thing the gate exists to catch, so the refusal is structural: there is no
// --force. The escape is a suppression, which lands in the diff and is reviewed.
export function refusedRecordings(findings, changedPaths) {
  const changed = new Set(changedPaths);
  return [...new Set(findings.filter((finding) => changed.has(finding.path)).map(keyFor))].sort();
}

// A recorded finding that no longer exists is debt that was paid: say so, so the
// file shrinks instead of rotting.
export function staleEntries(baseline, findings) {
  const present = new Set(findings.map(keyFor));
  return [...baseline].filter((key) => !present.has(key)).sort();
}
