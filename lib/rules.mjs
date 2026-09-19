// Rules judged on the lines a change adds. Deterministic only: naming and
// whether a comment earns its place are left to a reviewer, human or agent.
import { finding, SEVERITY } from "./finding.mjs";
import { allowsConsole, isIgnored } from "./paths.mjs";
import { checkSecrets } from "./secrets.mjs";
import { checkComments, commentBody } from "./comments.mjs";
import { suppressedRule } from "./suppression.mjs";

export { SEVERITY } from "./finding.mjs";
export { globToRegExp } from "./paths.mjs";
export { checkSecrets } from "./secrets.mjs";
export { checkComments, restatementRatio } from "./comments.mjs";

const CODE_EXTENSIONS = /\.(m?[jt]sx?|py|go|rb|java|cs|kt|swift|rs|php|sh)$/;
const TYPESCRIPT = /\.m?tsx?$/;
// Braces are a language property: Python and Ruby never use them for control
// flow, so a one-line `if` there is idiomatic rather than a finding.
const BRACE_LANGUAGES = /\.(m?[jt]sx?|java|cs|kt|swift|rs|php|go|c|cc|cpp|h|hpp)$/;
const DEBUGGER_STATEMENT = /(?:^|[;{}])\s*debugger\s*;?\s*(?:\/\/.*)?$/;
const CONSOLE_CALL = /\bconsole\.(log|debug|dir)\s*\(/;
const ANY_TYPE = /:\s*any\b|<any>|as any\b/;
const UNBRACED_CONTROL = /^\s*(?:if|for|while)\s*\(.*\)\s*(?!\{)\S/;
const BRACED_CONTROL = /^\s*(?:if|for|while)\s*\(.*\)\s*\{/;

export function checkCode(path, lines, config, fileLines) {
  const findings = [];
  const isTypeScript = TYPESCRIPT.test(path);

  for (const [index, { line, text }] of lines.entries()) {
    // A comment-only line is the comment rules' business: reading code patterns
    // inside prose is how a checker flags its own suppression text.
    if (commentBody(path, text) != null) {
      continue;
    }
    const suppressed = suppressedRule(lines[index], lines[index - 1]);
    const allow = (rule) => suppressed?.rule === rule;

    if (config.forbidDebugger && DEBUGGER_STATEMENT.test(text) && !allow("debugger")) {
      findings.push(
        finding({
          rule: "debugger",
          severity: SEVERITY.error,
          path,
          line,
          message: "debugger statement left in",
          fix: "remove it",
        }),
      );
    }
    if (
      config.forbidConsole &&
      CONSOLE_CALL.test(text) &&
      !allowsConsole(path, config.consoleAllowedIn) &&
      !allow("console")
    ) {
      findings.push(
        finding({
          rule: "console",
          severity: SEVERITY.warn,
          path,
          line,
          message: "console logging left in application code",
          fix: "remove it, or use the project's logger",
        }),
      );
    }
    if (config.forbidAny && isTypeScript && ANY_TYPE.test(text) && !allow("any")) {
      findings.push(
        finding({
          rule: "any",
          severity: SEVERITY.error,
          path,
          line,
          message: "`any` defeats the type checker",
          fix: "use `unknown` and narrow it, or name the real type",
        }),
      );
    }
    if (
      config.forbidOneLineIf &&
      BRACE_LANGUAGES.test(path) &&
      UNBRACED_CONTROL.test(text) &&
      !BRACED_CONTROL.test(text) &&
      !allow("one-line-if")
    ) {
      findings.push(
        finding({
          rule: "one-line-if",
          severity: SEVERITY.error,
          path,
          line,
          message: "single-line control statement without braces",
          fix: "use braces and a newline",
        }),
      );
    }
  }

  if (fileLines != null && fileLines > config.maxFileLines) {
    findings.push(
      finding({
        rule: "file-length",
        severity: SEVERITY.warn,
        path,
        line: 1,
        message: `${fileLines} lines (limit ${config.maxFileLines})`,
        fix: "split the distinct sections into their own files",
      }),
    );
  }
  return findings;
}

export function checkFiles(files, config, fileLineCounts = {}) {
  const findings = [];
  for (const [path, lines] of files) {
    // A test's fixtures are meant to contain the very things these rules catch.
    if (isIgnored(path, config.ignorePaths) || isIgnored(path, config.fixturePaths)) {
      continue;
    }
    if (config.secrets) {
      findings.push(...checkSecrets(path, lines));
    }
    if (!CODE_EXTENSIONS.test(path)) {
      continue;
    }
    findings.push(...checkComments(path, lines, config.comments));
    findings.push(...checkCode(path, lines, config.code, fileLineCounts[path]));
  }
  return findings;
}
