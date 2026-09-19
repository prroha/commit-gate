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
    .sort((a, b) => (a.path + a.line).localeCompare(b.path + b.line))
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
