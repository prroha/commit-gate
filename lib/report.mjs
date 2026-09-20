// Reporting findings: for a person, for a machine, and for an agent that can fix them.
import { SEVERITY } from "./rules.mjs";

// What a deterministic check cannot judge, handed to whoever reviews next.
export const JUDGEMENT_CHECKLIST = [
  "Do the names say what things are, so the comments are not needed?",
  "Does every remaining comment explain a reason the code cannot?",
  "Does the commit subject name the one thing this change does?",
  "Does the commit body say why, not what the diff already shows?",
  "Does each pull-request section tell a reviewer what to look at?",
];

// A commit-message or pull-request finding can carry no usable line number;
// those sort after the numbered ones instead of landing wherever a string
// comparison puts them.
const UNNUMBERED_LINE = Number.MAX_SAFE_INTEGER;

function lineOrder(line) {
  const number = typeof line === "string" ? Number(line) : line;
  return Number.isFinite(number) ? number : UNNUMBERED_LINE;
}

function byPathThenLine(first, second) {
  const byPath = first.path.localeCompare(second.path);
  if (byPath !== 0) {
    return byPath;
  }
  return lineOrder(first.line) - lineOrder(second.line);
}

export function countBySeverity(findings) {
  return {
    errors: findings.filter((finding) => finding.severity === SEVERITY.error).length,
    warnings: findings.filter((finding) => finding.severity === SEVERITY.warn).length,
  };
}

export function renderText(findings, { strict }) {
  if (findings.length === 0) {
    return "commit-gate: clean";
  }
  const lines = findings
    .slice()
    .sort(byPathThenLine)
    .map((finding) => {
      const label = finding.severity === SEVERITY.error ? "error" : "warn ";
      return `  ${label}  ${finding.path}:${finding.line}  ${finding.message}\n         → ${finding.fix}  [${finding.rule}]`;
    });
  const { errors, warnings } = countBySeverity(findings);
  const verdict =
    errors > 0
      ? `blocked: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
      : strict
        ? `blocked by --strict: ${warnings} warning${warnings === 1 ? "" : "s"}`
        : `passed with ${warnings} warning${warnings === 1 ? "" : "s"}`;
  return `${lines.join("\n")}\n\ncommit-gate: ${verdict}`;
}

export function renderJson(findings, { strict, baselineSkipped = 0 }) {
  const { errors, warnings } = countBySeverity(findings);
  return JSON.stringify(
    {
      blocked: errors > 0 || (strict && warnings > 0),
      errors,
      warnings,
      baselineSkipped,
      findings,
      judgementChecklist: JUDGEMENT_CHECKLIST,
    },
    null,
    2,
  );
}

// The block an agent reads: what to fix, then what to judge for itself.
export function renderForAgent(findings) {
  const { errors, warnings } = countBySeverity(findings);
  const fixes = findings.map(
    (finding) => `- ${finding.path}:${finding.line} — ${finding.message}. ${finding.fix} [${finding.rule}]`,
  );
  return [
    `commit-gate found ${errors} error(s) and ${warnings} warning(s).`,
    errors + warnings > 0 ? "\nFix these:\n" + fixes.join("\n") : "\nNothing mechanical to fix.",
    "\nThen judge these yourself, because no checker can:",
    ...JUDGEMENT_CHECKLIST.map((item) => `- ${item}`),
  ].join("\n");
}

// The verdict as text plus whether it blocks: printing belongs to the caller at
// the edge, so every command here stays testable and silent.
export function renderReport(findings, options, baselineSkipped = 0) {
  const { errors, warnings } = countBySeverity(findings);
  const blocked = errors > 0 || Boolean(options.strict && warnings > 0);

  if (options.json) {
    return { text: renderJson(findings, { strict: options.strict, baselineSkipped }), blocked };
  }
  if (options.agent) {
    return { text: renderForAgent(findings), blocked };
  }
  const lines = [renderText(findings, { strict: options.strict })];
  if (baselineSkipped > 0) {
    const plural = baselineSkipped === 1 ? "finding" : "findings";
    lines.push(`(${baselineSkipped} pre-existing ${plural} accepted by the baseline)`);
  }
  return { text: lines.join("\n"), blocked };
}
