// A rule can be wrong, so any finding can be silenced by name, with a reason.
// Trailing form silences its own line; next-line form silences the line below,
// which is the only option where a formatter would re-break a trailing comment.
import { finding, SEVERITY } from "./finding.mjs";

const TRAILING = /(?:\/\/|#|\/\*)\s*gate-ignore:\s*([a-z-]+)(?:\s+(.*))?/;
const NEXT_LINE = /(?:\/\/|#|\/\*)\s*gate-ignore-next-line:\s*([a-z-]+)(?:\s+(.*))?/;

function parse(pattern, text) {
  const match = pattern.exec(text ?? "");
  return match ? { rule: match[1], reason: (match[2] ?? "").trim() } : null;
}

// The previous entry only counts when it is the line directly above: with
// --unified=0 two array-adjacent lines can be a thousand lines apart.
export function isDirective(text) {
  return parse(TRAILING, text) != null || parse(NEXT_LINE, text) != null;
}

// The reason is the whole point of the syntax: it makes a suppression a
// sentence someone had to write rather than a token they could paste, and it
// is what the next reader finds instead of a bare rule name. The directive
// still silences its rule — reporting the silenced finding too would bury the
// one thing this says.
export function missingReason(path, entry) {
  const directive = parse(TRAILING, entry.text) ?? parse(NEXT_LINE, entry.text);
  if (directive == null || directive.reason !== "") {
    return null;
  }
  return finding({
    rule: "suppression-reason",
    severity: SEVERITY.error,
    path,
    line: entry.line,
    message: `the suppression of \`${directive.rule}\` gives no reason`,
    fix: `write why after the rule name: gate-ignore: ${directive.rule} <why this line is an exception>`,
  });
}

export function suppressedRule(line, previous) {
  const trailing = parse(TRAILING, line?.text);
  if (trailing) {
    return trailing;
  }
  if (previous == null || previous.line !== line.line - 1) {
    return null;
  }
  return parse(NEXT_LINE, previous.text);
}
