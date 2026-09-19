// Unit tests for the deterministic rules. No git, no filesystem.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, mergeConfig } from "../lib/config.mjs";
import { addedLines } from "../lib/git.mjs";
import { checkCode, checkComments, checkFiles, checkSecrets, globToRegExp, restatementRatio } from "../lib/rules.mjs";
import { checkMessage, looksImperative, splitMessage } from "../lib/message.mjs";
import { checkPullRequest, sectionsOf } from "../lib/pr.mjs";
import { applyBaseline, keyFor, refusedRecordings, staleEntries } from "../lib/baseline.mjs";
import { RULES, renderRules } from "../lib/catalogue.mjs";
import { countBySeverity, renderForAgent, renderReport } from "../lib/report.mjs";
import { runRules } from "../lib/commands.mjs";

const lines = (...texts) => texts.map((text, index) => ({ line: index + 1, text }));
const rulesOf = (findings) => findings.map((finding) => finding.rule);

test("reads only the lines a diff adds, with their real line numbers", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,0 +11,2 @@",
    "+const first = 1;",
    "+const second = 2;",
    "@@ -30,1 +40,1 @@",
    "-const removed = 3;",
    "+const replaced = 3;",
  ].join("\n");
  const files = addedLines(diff);
  assert.deepEqual(files.get("src/a.ts"), [
    { line: 11, text: "const first = 1;" },
    { line: 12, text: "const second = 2;" },
    { line: 40, text: "const replaced = 3;" },
  ]);
});

test("flags a comment that describes a change rather than the code", () => {
  const findings = checkComments("a.ts", lines("// Updated to use the new client"), DEFAULTS.comments);
  assert.deepEqual(rulesOf(findings), ["changelog-comment"]);
  assert.equal(findings[0].severity, "error");
});

test("flags commented-out code, and leaves prose alone", () => {
  assert.deepEqual(
    rulesOf(checkComments("a.ts", lines("// const old = charge(token);"), DEFAULTS.comments)),
    ["commented-out-code"],
  );
  assert.deepEqual(
    rulesOf(checkComments("a.ts", lines("// Rounding matters here: the carrier rejects fractional cents."), DEFAULTS.comments)),
    [],
  );
});

test("flags a comment that repeats the line below, including camelCase names", () => {
  const findings = checkComments(
    "a.ts",
    lines("// get the customer", "const customer = getCustomer(token);"),
    DEFAULTS.comments,
  );
  assert.deepEqual(rulesOf(findings), ["restated-comment"]);
  assert.equal(findings[0].severity, "warn");
});

test("keeps a comment that explains a reason", () => {
  const findings = checkComments(
    "a.ts",
    lines("// The carrier rejects a second charge within a minute.", "await sleep(60_000);"),
    DEFAULTS.comments,
  );
  assert.deepEqual(rulesOf(findings), []);
});

test("measures how much of a comment the next line already says", () => {
  assert.ok(restatementRatio("get the customer", "const customer = getCustomer(token);") >= 0.6);
  assert.ok(restatementRatio("carriers reject fractional cents", "const total = round(amount);") < 0.5);
  assert.equal(restatementRatio("", "const x = 1;"), 0);
});

test("flags debugger, any, one-line control statements and console", () => {
  const findings = checkCode(
    "src/a.ts",
    lines("debugger;", "function f(x: any) {}", "if (!x) return null;", "console.log(x);"),
    DEFAULTS.code,
    null,
  );
  assert.deepEqual(rulesOf(findings).sort(), ["any", "console", "debugger", "one-line-if"]);
});

test("leaves a braced control statement alone", () => {
  assert.deepEqual(rulesOf(checkCode("src/a.ts", lines("if (!x) {"), DEFAULTS.code, null)), []);
});

test("allows console where a project says it belongs", () => {
  assert.deepEqual(rulesOf(checkCode("scripts/seed.ts", lines("console.log(x);"), DEFAULTS.code, null)), []);
  assert.deepEqual(rulesOf(checkCode("src/a.test.ts", lines("console.log(x);"), DEFAULTS.code, null)), []);
});

test("a suppression with a reason silences one rule only", () => {
  assert.deepEqual(
    rulesOf(checkCode("src/a.ts", lines("const client: any = sdk(); // gate-ignore: any the SDK ships no types"), DEFAULTS.code, null)),
    [],
  );
  assert.deepEqual(
    rulesOf(checkCode("src/a.ts", lines("debugger; // gate-ignore: any"), DEFAULTS.code, null)),
    ["debugger"],
  );
});

test("flags a long file", () => {
  assert.deepEqual(rulesOf(checkCode("src/a.ts", lines("const x = 1;"), DEFAULTS.code, 400)), ["file-length"]);
});

test("leaves a test's own fixtures alone", () => {
  const files = new Map([
    ["src/app.ts", lines("debugger;")],
    ["test/app.test.ts", lines("debugger;", 'const key = "sk_live_51H8xQ2abcdefghij";')],
  ]);
  assert.deepEqual(
    checkFiles(files, DEFAULTS, {}).map((finding) => finding.path),
    ["src/app.ts"],
  );
});

test("flags credentials and keys of several shapes", () => {
  const findings = checkSecrets(
    "src/a.ts",
    lines(
      'const key = "sk_live_51H8xQ2abcdefghij";',
      'const password = "hunter2hunter2hunter2";',
      "const id = AKIAIOSFODNN7EXAMPLE;",
      "const safe = process.env.API_KEY;",
    ),
  );
  assert.equal(findings.length, 3);
  assert.ok(findings.every((finding) => finding.severity === "error"));
});

test("skips generated and vendored paths", () => {
  const files = new Map([
    ["node_modules/pkg/index.js", lines("debugger;")],
    ["dist/out.js", lines("debugger;")],
    ["src/app.js", lines("debugger;")],
  ]);
  assert.deepEqual(
    checkFiles(files, DEFAULTS, {}).map((finding) => finding.path),
    ["src/app.js"],
  );
});

test("globs understand **/, ** and *", () => {
  assert.ok(globToRegExp("**/node_modules/**").test("a/b/node_modules/x.js"));
  assert.ok(globToRegExp("**/node_modules/**").test("node_modules/x.js"));
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.equal(globToRegExp("src/*.ts").test("src/nested/a.ts"), false);
});

test("splits a commit message into subject and body, ignoring git's comments", () => {
  const { subject, body } = splitMessage("fix: reject an expired token\n\nIt let a stale session through.\n# comment\n");
  assert.equal(subject, "fix: reject an expired token");
  assert.equal(body, "It let a stale session through.");
});

test("knows the imperative mood from the past tense", () => {
  assert.ok(looksImperative("add a retry to the charge path"));
  assert.ok(looksImperative("fix(auth): reject an expired token"));
  assert.equal(looksImperative("added a retry"), false);
  assert.equal(looksImperative("fixes the bug"), false);
  assert.equal(looksImperative("updating the client"), false);
});

test("flags a long subject, a trailing period and a missing body", () => {
  const findings = checkMessage(`${"a".repeat(80)}.`, DEFAULTS.message);
  assert.ok(rulesOf(findings).includes("subject-length"));
  assert.ok(rulesOf(findings).includes("subject-period"));
  assert.ok(rulesOf(findings).includes("no-body"));
});

test("accepts a good message", () => {
  const findings = checkMessage(
    "add a retry to the charge path\n\nThe provider drops one request in a thousand, and a dropped charge\nlooked like a decline to the customer.\n",
    DEFAULTS.message,
  );
  assert.deepEqual(rulesOf(findings), []);
});

test("flags a body that lists files instead of saying why", () => {
  const findings = checkMessage(
    "add retries\n\n- src/charge.ts\n- src/retry.ts\n- src/index.ts\n",
    DEFAULTS.message,
  );
  assert.ok(rulesOf(findings).includes("body-file-list"));
});

test("can require Conventional Commits, and forbid chosen lines", () => {
  const config = mergeConfig(DEFAULTS.message, { requireConventional: true, forbiddenLines: ["Co-Authored-By: Bot"] });
  assert.ok(rulesOf(checkMessage("add a retry\n\nbecause\n", config)).includes("conventional"));
  assert.ok(
    rulesOf(checkMessage("fix: add a retry\n\nbecause\n\nCo-Authored-By: Bot <b@example.com>\n", config)).includes("forbidden-line"),
  );
});

test("reads pull-request sections from headings of either style", () => {
  const sections = sectionsOf("## Description\nwhat\n\n**Motivation**\nwhy\n");
  assert.deepEqual([...sections.keys()], ["Description", "Motivation"]);
  assert.equal(sections.get("Motivation"), "why");
});

test("flags a missing or empty pull-request section", () => {
  const body = "## Description\nAdds a retry.\n\n## Motivation\n\n## Testing\nRan the suite.\n";
  const findings = checkPullRequest(body, DEFAULTS.pr);
  assert.ok(findings.some((finding) => finding.rule === "empty-section" && finding.message.includes("Motivation")));
  assert.ok(findings.some((finding) => finding.rule === "missing-section" && finding.message.includes("Rollout")));
});

test("accepts a filled-in body, and warns when a section runs long", () => {
  const filled = ["Description", "Motivation", "Testing", "Rollout"]
    .map((name) => `## ${name}\nOne short line.`)
    .join("\n\n");
  assert.deepEqual(rulesOf(checkPullRequest(filled, DEFAULTS.pr)), []);

  const wordy = filled.replace("## Testing\nOne short line.", `## Testing\n${"word ".repeat(200)}`);
  assert.ok(rulesOf(checkPullRequest(wordy, DEFAULTS.pr)).includes("long-section"));
});

test("warns when the pull request repeats the commit message", () => {
  const narrative =
    "The provider drops one request in a thousand, and a dropped charge looked like a decline to the customer, so we retry once.";
  const body = ["Description", "Motivation", "Testing", "Rollout"]
    .map((name) => `## ${name}\n${name === "Motivation" ? narrative : "short"}`)
    .join("\n\n");
  assert.ok(rulesOf(checkPullRequest(body, DEFAULTS.pr, narrative)).includes("duplicated-narrative"));
});

test("a baseline accepts existing findings by rule and path, not by line", () => {
  const findings = [
    { rule: "any", path: "src/old.ts", line: 10 },
    { rule: "any", path: "src/new.ts", line: 4 },
  ];
  const baseline = new Set([keyFor({ rule: "any", path: "src/old.ts" })]);
  const { kept, skipped } = applyBaseline(findings, baseline);
  assert.equal(skipped, 1);
  assert.deepEqual(kept.map((finding) => finding.path), ["src/new.ts"]);
});

test("counts severities and writes an agent block that says what to judge", () => {
  const findings = [
    { rule: "any", severity: "error", path: "a.ts", line: 1, message: "m", fix: "f" },
    { rule: "console", severity: "warn", path: "a.ts", line: 2, message: "m", fix: "f" },
  ];
  assert.deepEqual(countBySeverity(findings), { errors: 1, warnings: 1 });
  const block = renderForAgent(findings);
  assert.match(block, /1 error\(s\) and 1 warning\(s\)/);
  assert.match(block, /judge these yourself/);
  assert.match(block, /names say what things are/);
});

test("a next-line suppression only reaches the line directly below", () => {
  const adjacent = [
    { line: 11, text: "// gate-ignore-next-line: any the SDK ships no types" },
    { line: 12, text: "const client: any = sdk();" },
  ];
  assert.deepEqual(rulesOf(checkCode("a.ts", adjacent, DEFAULTS.code, null)), []);

  const distant = [
    { line: 11, text: "// gate-ignore-next-line: any the SDK ships no types" },
    { line: 900, text: "const unrelated: any = other();" },
  ];
  assert.deepEqual(rulesOf(checkCode("a.ts", distant, DEFAULTS.code, null)), ["any"]);
});

test("a suppression silences the rule it names, not every comment rule", () => {
  const lines = [
    { line: 1, text: "// gate-ignore-next-line: console we print on purpose" },
    { line: 2, text: "// Updated the retry count to three" },
  ];
  assert.deepEqual(rulesOf(checkComments("a.ts", lines, DEFAULTS.comments)), ["changelog-comment"]);
});

test("code rules ignore comment-only lines, so prose about code is safe", () => {
  const lines = [
    { line: 1, text: "// we call console.log in the CLI, and pass any value through" },
    { line: 2, text: "const total = 1;" },
  ];
  assert.deepEqual(rulesOf(checkCode("a.ts", lines, DEFAULTS.code, null)), []);
});

test("refuses to record a finding in a file the change touches, finding or not", () => {
  const findings = [
    { rule: "any", path: "src/touched.ts", line: 3 },
    { rule: "any", path: "src/untouched.ts", line: 9 },
  ];
  assert.deepEqual(refusedRecordings(findings, ["src/touched.ts"]), ["any::src/touched.ts"]);
  assert.deepEqual(refusedRecordings(findings, ["src/elsewhere.ts"]), []);
});

test("reports a recorded finding that nothing violates any more", () => {
  const baseline = new Set(["any::src/fixed.ts", "any::src/still.ts"]);
  assert.deepEqual(staleEntries(baseline, [{ rule: "any", path: "src/still.ts" }]), ["any::src/fixed.ts"]);
});

test("the catalogue covers every rule the checks can report", () => {
  const catalogued = new Set(RULES.map((entry) => entry.rule));
  for (const rule of ["secret", "empty-pr", "missing-section", "restated-comment", "file-length"]) {
    assert.ok(catalogued.has(rule), `${rule} is missing from the catalogue`);
  }
  assert.match(renderRules(), /advisory: /);
});

test("a report is text plus whether it blocks, and prints nothing itself", () => {
  const error = { rule: "any", severity: "error", path: "a.ts", line: 1, message: "m", fix: "f" };
  const warning = { rule: "console", severity: "warn", path: "a.ts", line: 2, message: "m", fix: "f" };

  assert.deepEqual(renderReport([], { json: false }), { text: "commit-gate: clean", blocked: false });
  assert.equal(renderReport([error], { json: false }).blocked, true);
  assert.equal(renderReport([warning], { json: false }).blocked, false);
  assert.equal(renderReport([warning], { json: false, strict: true }).blocked, true);

  const json = JSON.parse(renderReport([error], { json: true }).text);
  assert.equal(json.blocked, true);
  assert.equal(json.errors, 1);
});

test("the rules command needs no repository and no terminal", () => {
  const { text, blocked } = runRules();
  assert.equal(blocked, false);
  assert.match(text, /secret/);
});
