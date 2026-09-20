// Comment rules: a comment should give a reason, and say nothing the code says.
import { finding, SEVERITY } from "./finding.mjs";
import { isDirective, missingReason, suppressedRule } from "./suppression.mjs";

const SLASH_COMMENT = /^\s*\/\/\s?(.*)$/;
const HASH_COMMENT = /^\s*#\s?(.*)$/;
const HASH_COMMENT_LANGUAGES = /\.(py|rb|sh|ya?ml|tf|pl)$/;

const CHANGELOG_WORDS =
  /^(updated?|changed?|added?|removed?|renamed?|moved?|fixed?|new|now|previously|was|used to|no longer|refactored?)\b/i;
const CHANGELOG_PHRASES = /\b(we just|as discussed|per review|for now|temporary|temp fix|see ticket)\b/i;
// Shapes that are code rather than prose about code. A keyword alone is not
// enough: "for this long" opens a sentence, not a loop.
const CODE_IN_COMMENT = [
  /^(?:const|let|var)\s+[\w{[]/,
  /^function\s*\w*\s*\(/,
  /^class\s+\w+/,
  /^(?:if|for|while|switch)\s*\(/,
  /^(?:import|export)\s+[\w{*]/,
  /^return\b.*;\s*$/,
  /=>/,
  /\)\s*\{\s*$/,
  // A statement ending in a semicolon carries a call or an assignment; prose
  // ending in one is still prose.
  /(?:\(|=)[^;]*;\s*$/,
];

function looksLikeCode(body) {
  return CODE_IN_COMMENT.some((pattern) => pattern.test(body));
}

const FILLER_WORDS = ["the", "and", "for", "this", "that", "with", "from", "into", "get", "set"];

// A # line is a comment in Python or shell, and shell inside a JavaScript
// template literal. Read the style the file's own language uses.
export function commentBody(path, text) {
  const match = HASH_COMMENT_LANGUAGES.test(path) ? HASH_COMMENT.exec(text) : SLASH_COMMENT.exec(text);
  return match ? match[1].trim() : null;
}

function tokens(text, { splitIdentifiers = false } = {}) {
  const source = splitIdentifiers
    ? text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")
    : text;
  return (source.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter(
    (word) => !FILLER_WORDS.includes(word),
  );
}

// A comment whose words are mostly the identifiers below it is saying what the
// code already says.
export function restatementRatio(comment, nextLine) {
  const commentWords = tokens(comment);
  if (commentWords.length === 0) {
    return 0;
  }
  const codeWords = new Set(tokens(nextLine, { splitIdentifiers: true }));
  const shared = commentWords.filter((word) => codeWords.has(word)).length;
  return shared / commentWords.length;
}

function continuesAComment(path, lines, index) {
  const previous = lines[index - 1];
  if (previous == null || previous.line !== lines[index].line - 1) {
    return false;
  }
  // A directive is a comment, but it starts nothing: the line under it is still
  // the first line of whatever follows.
  return commentBody(path, previous.text) != null && !isDirective(previous.text);
}

function describesAChange(body) {
  return CHANGELOG_WORDS.test(body) || CHANGELOG_PHRASES.test(body);
}

function repeatsNextLine(path, body, next, overlap) {
  return (
    next != null &&
    commentBody(path, next.text) == null &&
    restatementRatio(body, next.text) >= overlap
  );
}

export function checkComments(path, lines, config) {
  const findings = [];

  for (let index = 0; index < lines.length; index++) {
    const { line, text } = lines[index];
    const body = commentBody(path, text);
    if (body == null || body === "") {
      continue;
    }
    const suppressed = suppressedRule(lines[index], lines[index - 1]);
    const allow = (rule) => suppressed?.rule === rule;
    // Judged before the continuation skip below: a directive under a comment is
    // still a directive, and a missing reason is a property of the line itself.
    const reasonless = missingReason(path, lines[index]);
    if (reasonless != null) {
      findings.push(reasonless);
    }
    // Only a block's first line is judged: a wrapped comment's later lines are
    // sentence fragments, and fragments read as anything.
    if (continuesAComment(path, lines, index)) {
      continue;
    }

    if (config.forbidChangelogComments && describesAChange(body) && !allow("changelog-comment")) {
      findings.push(
        finding({
          rule: "changelog-comment",
          severity: SEVERITY.error,
          path,
          line,
          message: `comment describes a change, not the code: "${body.slice(0, 60)}"`,
          fix: "say what is true now, or delete it; the diff already records the change",
        }),
      );
      continue;
    }

    if (config.warnCommentedOutCode && looksLikeCode(body) && !allow("commented-out-code")) {
      findings.push(
        finding({
          rule: "commented-out-code",
          severity: SEVERITY.warn,
          path,
          line,
          message: "looks like commented-out code",
          fix: "delete it; git remembers",
        }),
      );
      continue;
    }

    if (
      config.warnRestatedComments &&
      !allow("restated-comment") &&
      repeatsNextLine(path, body, lines[index + 1], config.restatementOverlap)
    ) {
      findings.push(
        finding({
          rule: "restated-comment",
          severity: SEVERITY.warn,
          path,
          line,
          message: "comment repeats the line below it",
          fix: "delete it, or replace it with the reason the code is this way",
        }),
      );
    }
  }
  return findings;
}
