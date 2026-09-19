// A rule can be wrong, so any finding can be silenced by name, with a reason.
// Trailing form silences its own line; next-line form silences the line below,
// which is the only option where a formatter would re-break a trailing comment.
const TRAILING = /(?:\/\/|#|\/\*)\s*gate-ignore:\s*([a-z-]+)(?:\s+(.*))?/;
const NEXT_LINE = /(?:\/\/|#|\/\*)\s*gate-ignore-next-line:\s*([a-z-]+)(?:\s+(.*))?/;

function parse(pattern, text) {
  const match = pattern.exec(text ?? "");
  return match ? { rule: match[1], reason: (match[2] ?? "").trim() } : null;
}

// The previous entry only counts when it is the line directly above: with
// --unified=0 two array-adjacent lines can be a thousand lines apart.
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
