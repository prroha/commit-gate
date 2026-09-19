// Checking a commit message: one clear subject, and a body that says why.
import { SEVERITY } from "./rules.mjs";

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;
const PAST_TENSE_OR_GERUND = /^(?:[A-Z]?[a-z]+(?:ed|ing)|[A-Z]?[a-z]+s)\b/;
const IMPERATIVE_EXCEPTIONS = new Set(["address", "process", "bless", "express", "focus", "pass", "dismiss"]);
const FILE_LIST_LINE = /^\s*[-*]\s+\S+\.(m?[jt]sx?|py|go|rb|java|cs|md|json|ya?ml)\b/;

export function splitMessage(text) {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const [subject, ...rest] = withoutComments.trimStart().split("\n");
  return { subject: (subject ?? "").trim(), body: rest.join("\n").trim() };
}

export function looksImperative(subject) {
  const withoutPrefix = subject.replace(CONVENTIONAL, (match) => match.slice(match.indexOf(": ") + 2));
  const firstWord = (withoutPrefix.match(/[A-Za-z]+/) ?? [""])[0];
  if (firstWord === "" || IMPERATIVE_EXCEPTIONS.has(firstWord.toLowerCase())) {
    return true;
  }
  return !PAST_TENSE_OR_GERUND.test(firstWord);
}

export function checkMessage(text, config) {
  const { subject, body } = splitMessage(text);
  const findings = [];
  const at = (line, rule, severity, message, fix) => findings.push({ rule, severity, path: "commit message", line, message, fix });

  if (subject === "") {
    at(1, "empty-subject", SEVERITY.error, "the commit has no subject line", "write one line saying what the change does");
    return findings;
  }
  if (subject.length > config.maxSubjectLength) {
    at(1, "subject-length", SEVERITY.error, `subject is ${subject.length} characters (limit ${config.maxSubjectLength})`, "say the one thing this change does; details belong in the body");
  }
  if (config.forbidSubjectPeriod && subject.endsWith(".")) {
    at(1, "subject-period", SEVERITY.error, "subject ends with a period", "drop it");
  }
  if (config.requireConventional && !CONVENTIONAL.test(subject)) {
    at(1, "conventional", SEVERITY.error, "subject is not in Conventional Commits form", "use type(scope): summary, e.g. fix(auth): reject an expired token");
  }
  if (config.requireImperative && !looksImperative(subject)) {
    at(1, "imperative", SEVERITY.warn, "subject is not in the imperative mood", 'write "add x", not "added x" or "adds x"');
  }
  if (body === "") {
    at(1, "no-body", SEVERITY.warn, "no body: nothing records why this change was made", "one or two sentences on the reason, or delete this warning from your config if the subject is enough");
  }

  const bodyLines = body.split("\n");
  bodyLines.forEach((line, index) => {
    if (line.length > config.maxBodyLineLength) {
      at(index + 3, "body-line-length", SEVERITY.warn, `body line is ${line.length} characters (limit ${config.maxBodyLineLength})`, "wrap it");
    }
  });

  const listLines = bodyLines.filter((line) => FILE_LIST_LINE.test(line)).length;
  if (listLines >= 3) {
    at(3, "body-file-list", SEVERITY.warn, "the body lists files the diff already shows", "say why the change was needed instead");
  }

  for (const forbidden of config.forbiddenLines) {
    if (text.includes(forbidden)) {
      at(1, "forbidden-line", SEVERITY.error, `message contains a forbidden line: ${forbidden}`, "remove it");
    }
  }
  return findings;
}
