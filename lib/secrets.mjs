// Credentials that should never reach a repository.
import { finding, SEVERITY } from "./finding.mjs";

const SECRET_PATTERNS = [
  { id: "aws-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // A credential-shaped value, not any string: `key: "nightly-sync"` is a UI
  // identifier, while a real key carries mixed case or digits and no hyphens.
  {
    id: "inline-credential",
    pattern:
      /\b(?:secret|token|api[_-]?key|key|password|passwd|pwd|auth)\s*[:=]\s*['"](?=[^'"\s]{16,}['"])(?=[^'"]*\d)[A-Za-z0-9+/=_.]{16,}['"]/i,
  },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "vendor-key", pattern: /\b(?:sk|pk|rk)_(?:live|test|prod)_[A-Za-z0-9]{12,}\b/ },
  { id: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
];

export function checkSecrets(path, lines) {
  const findings = [];
  for (const { line, text } of lines) {
    // One finding per line: several patterns matching the same key is still one key.
    const matched = SECRET_PATTERNS.find(({ pattern }) => pattern.test(text));
    if (matched) {
      findings.push(
        finding({
          rule: "secret",
          severity: SEVERITY.error,
          path,
          line,
          message: `looks like a committed secret (${matched.id})`,
          fix: "move it to an environment variable or a secrets manager, then rotate it",
        }),
      );
    }
  }
  return findings;
}

