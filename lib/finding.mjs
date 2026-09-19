// The one shape every rule reports, and the two severities a gate needs.
export const SEVERITY = { error: "error", warn: "warn" };

export function finding({ rule, severity, path, line, message, fix }) {
  return { rule, severity, path, line, message, fix };
}
