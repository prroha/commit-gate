// A rule can be wrong, so any finding can be silenced by name, with a reason.
const SUPPRESSION = /(?:\/\/|#|\/\*)\s*gate-ignore:\s*([a-z-]+)(?:\s+(.*))?/;

export function suppressedRule(text) {
  const match = SUPPRESSION.exec(text);
  return match ? { rule: match[1], reason: (match[2] ?? "").trim() } : null;
}
