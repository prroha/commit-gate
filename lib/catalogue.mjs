// Every rule, its severity, and for an advisory rule the reason it never blocks.
import { SEVERITY } from "./finding.mjs";
// A rule that reads a legitimate choice as a defect often enough stays advisory:
// gating it would teach people to route around the gate.
export const RULES = [
  { rule: "secret", severity: SEVERITY.error, about: "credentials, tokens and private keys" },
  { rule: "debugger", severity: SEVERITY.error, about: "a debugger statement left in" },
  { rule: "any", severity: SEVERITY.error, about: "`any` in TypeScript" },
  { rule: "one-line-if", severity: SEVERITY.error, about: "a control statement without braces" },
  { rule: "changelog-comment", severity: SEVERITY.error, about: "a comment describing the change" },
  {
    rule: "console",
    severity: SEVERITY.warn,
    about: "console logging in application code",
    advisoryReason: "a CLI, a script and a test legitimately print",
  },
  {
    rule: "commented-out-code",
    severity: SEVERITY.warn,
    about: "code hiding in a comment",
    advisoryReason: "prose about code can look like code",
  },
  {
    rule: "restated-comment",
    severity: SEVERITY.warn,
    about: "a comment repeating the line below",
    advisoryReason: "word overlap is a heuristic, not a reading",
  },
  {
    rule: "file-length",
    severity: SEVERITY.warn,
    about: "a file past the line limit",
    advisoryReason: "a generated or data-heavy file is legitimately long",
  },
  { rule: "subject-length", severity: SEVERITY.error, about: "a commit subject past the limit" },
  { rule: "subject-period", severity: SEVERITY.error, about: "a subject ending in a period" },
  { rule: "empty-subject", severity: SEVERITY.error, about: "a commit with no subject" },
  { rule: "conventional", severity: SEVERITY.error, about: "a subject outside Conventional Commits (off by default)" },
  { rule: "forbidden-line", severity: SEVERITY.error, about: "a line the project never wants committed" },
  { rule: "imperative", severity: SEVERITY.warn, about: "a subject in the past tense", advisoryReason: "English verb shapes overlap" },
  { rule: "no-body", severity: SEVERITY.warn, about: "a commit with no body", advisoryReason: "a small change can be self-evident" },
  { rule: "body-line-length", severity: SEVERITY.warn, about: "an unwrapped body line" },
  { rule: "body-file-list", severity: SEVERITY.warn, about: "a body listing files the diff shows" },
  { rule: "empty-pr", severity: SEVERITY.error, about: "an empty pull-request body" },
  { rule: "missing-section", severity: SEVERITY.error, about: "a required pull-request section absent" },
  { rule: "empty-section", severity: SEVERITY.error, about: "a required section left empty" },
  { rule: "long-section", severity: SEVERITY.warn, about: "a section that became an essay" },
  { rule: "duplicated-narrative", severity: SEVERITY.warn, about: "a body repeating the commit message" },
];

export function renderRules() {
  const width = Math.max(...RULES.map((entry) => entry.rule.length));
  return RULES.map((entry) => {
    const advisory = entry.advisoryReason ? `  (advisory: ${entry.advisoryReason})` : "";
    const label = entry.severity === SEVERITY.error ? "error" : "warn ";
    return `  ${label}  ${entry.rule.padEnd(width)}  ${entry.about}${advisory}`;
  }).join("\n");
}
