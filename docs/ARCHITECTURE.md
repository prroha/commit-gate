# Architecture

How commit-gate is put together, why it is shaped this way, and where to change things.

## The idea in one line

**Every check reads a list of `{ line, text }` and returns a list of `Finding`; everything
else is reading, filtering and rendering.**

No dependencies, no parser, no network. Git prints a diff, the rules read added lines, and
one renderer turns findings into text, JSON or an agent block.

## Shape

```
  git diff --unified=0            a message file / HEAD        a PR body file
          |                              |                           |
          v                              v                           v
   git.addedLines                 message.splitMessage         pr.sectionsOf
   Map<path, Line[]>                     |                           |
          |                              v                           v
          v                       message.checkMessage       pr.checkPullRequest
   rules.checkFiles                      |                           |
     ├─ paths.isIgnored                  |                           |
     ├─ secrets.checkSecrets             |                           |
     ├─ comments.checkComments           |                           |
     └─ rules.checkCode                  |                           |
          |                              |                           |
          └──────────────┬───────────────┴───────────────────────────┘
                         v
                   Finding[]  ──►  baseline.applyBaseline  (check only)
                                         |
                                         v
                                  report.renderReport
                                { text, blocked }
                                         |
                    ┌────────────────────┼────────────────────┐
                    v                    v                    v
              renderText            renderJson          renderForAgent
```

Everything flows one way. No check knows about rendering; no renderer knows about git;
`bin/commit-gate.mjs` is the only file that prints or exits.

## The modules

| Module | Lines | Responsibility | Depends on |
|---|---|---|---|
| `lib/finding.mjs` | 6 | The `Finding` shape and the two severities | nothing |
| `lib/paths.mjs` | 28 | `globToRegExp`, `isIgnored`, `allowsConsole` — which files a rule applies to | nothing |
| `lib/suppression.mjs` | 49 | `gate-ignore` parsing: `suppressedRule`, `isDirective`, `missingReason` | `finding` |
| `lib/secrets.mjs` | 39 | `checkSecrets` — credential shapes | `finding` |
| `lib/comments.mjs` | 153 | `commentBody`, `restatementRatio`, `checkComments` | `finding`, `suppression` |
| `lib/rules.mjs` | 143 | `checkCode`, `checkFiles` — code rules, and the one place files are filtered | `finding`, `paths`, `secrets`, `comments`, `suppression` |
| `lib/message.mjs` | 70 | `splitMessage`, `looksImperative`, `checkMessage` | `rules` (for `SEVERITY`) |
| `lib/pr.mjs` | 78 | `sectionsOf`, `checkPullRequest` | `rules` (for `SEVERITY`) |
| `lib/catalogue.mjs` | 59 | `RULES` and `renderRules` — the static list behind `commit-gate rules` | `finding` |
| `lib/baseline.mjs` | 53 | `keyFor`, `loadBaseline`, `writeBaseline`, `applyBaseline`, `refusedRecordings`, `staleEntries` | nothing |
| `lib/report.mjs` | 107 | `countBySeverity`, `renderText`, `renderJson`, `renderForAgent`, `renderReport`, `JUDGEMENT_CHECKLIST` | `rules` (for `SEVERITY`) |
| `lib/git.mjs` | 133 | `repositoryRoot`, `diffFor`, `addedLines`, `changedPaths`, `fileLineCount`, `trackedFiles`, `allLinesOf`, `commitMessageFrom` | `node:child_process`, `node:fs` |
| `lib/config.mjs` | 83 | `DEFAULTS`, `loadConfig`, `mergeConfig` | `node:fs` |
| `lib/install.mjs` | 124 | `install` — hooks, `SKILL.md`, the `AGENT_SECTION` appended to `CLAUDE.md`/`AGENTS.md` | `node:fs` |
| `lib/help.mjs` | 40 | The `HELP` string | nothing |
| `lib/commands.mjs` | 141 | `runCheck`, `runMessage`, `runPullRequest`, `runBaseline`, `runInstall`, `runRules`, `contentSourceFor`, `UsageError` | all of the above |
| `bin/commit-gate.mjs` | 142 | Argument parsing, dispatch, printing, exit codes | `config`, `help`, `git`, `commands` |

`lib/rules.mjs` re-exports `SEVERITY`, `globToRegExp`, `checkSecrets`, `checkComments` and
`restatementRatio`, so `message.mjs`, `pr.mjs`, `report.mjs` and the tests import from one
place rather than reaching into four.

## The data model

```js
Finding = { rule, severity, path, line, message, fix }
```

Six fields, built by `finding()` in `lib/finding.mjs`. `severity` is `"error"` or `"warn"`,
nothing else — a gate needs one bit (does this block?) plus the ability to say something
without blocking.

- **`fix` is mandatory in practice.** Every rule supplies one, because the output is read
  by someone about to change the line, and often by an agent that will act on it verbatim.
  A finding without a remedy is a complaint.
- **`path` is not always a file.** `checkMessage` sets `"commit message"` and
  `checkPullRequest` sets `"pull request"`, so one renderer handles all three checks
  without knowing which produced what.
- **`rule` is the stable identifier.** It is what a suppression names, what a baseline key
  is built from, and what is printed in brackets at the end of every text line. Renaming a
  rule breaks existing suppressions and baselines; that is the cost of making the
  identifier human-typable.
- **`Finding` is a plain object, not a class.** It has to survive `JSON.stringify` for
  `--json` unchanged.

`message.mjs` and `pr.mjs` build the same object inline through a local `at()` helper
rather than importing `finding()`. Slight duplication, no behavioural difference.

## Three ideas that drive most of the code

### 1. Only added lines are judged

`git.diffFor` runs `git diff --unified=0 --no-color --diff-filter=ACMR`, and
`git.addedLines` keeps only lines starting with `+`, tracking the real post-image line
number from each `@@ -a,b +c,d @@` header.

The consequence is the whole adoption story: a one-line fix inside a thousand-line legacy
file is judged on that one line. The gate can be installed in an old repository on a
Tuesday without a cleanup weekend first.

`--unified=0` is not only for economy. With zero context, every `+` line in the map is a
line this change actually wrote, so no rule can ever fire on untouched code. It also
creates the one awkwardness the code has to defend against: two entries adjacent in the
array can be a thousand lines apart in the file. Both `suppression.suppressedRule` and
`comments.continuesAComment` therefore check `previous.line === current.line - 1` before
treating the previous entry as the line above.

### 2. Rules are a flat list, not a registry

There is no plugin interface and no rule objects with `match()` methods. `checkCode` is a
`for` loop over lines with four `if` blocks; `checkComments` is a loop with three. A rule
is a regular expression plus a `finding()` call.

The composition happens once, in `rules.checkFiles`:

```js
for (const [path, lines] of files) {
  if (isIgnored(path, config.ignorePaths) || isIgnored(path, config.fixturePaths)) continue;
  if (config.secrets) findings.push(...checkSecrets(path, lines));
  if (!CODE_EXTENSIONS.test(path)) continue;
  findings.push(...checkComments(path, lines, config.comments));
  findings.push(...checkCode(path, lines, config.code, fileLineCounts[path]));
}
```

Two things are deliberate there. Secrets run **before** the `CODE_EXTENSIONS` gate, so a
key committed into a `.env`, a lock file or a README is still caught; everything else is
code-only. `CODE_EXTENSIONS` names every extension whose comment style `commentBody` knows,
`.yml`, `.yaml`, `.tf` and `.pl` included — a language the comment rules can read is a
language they are given. And ignore paths and fixture paths are checked together, so a rule never sees a
test's own fixture — a test file's job is to contain the exact strings these rules hunt,
and a checker that fails its own test suite teaches people to disable it.

`lib/catalogue.mjs` is a separate, hand-maintained list of every rule with its severity and,
for advisory rules, the reason it never blocks. It is documentation, not dispatch: nothing
reads it at check time, and `commit-gate rules` is served from it without opening a
repository at all (`bin/commit-gate.mjs` short-circuits that command before
`repositoryRoot`). Nothing dispatches from it, so a unit test reads the rule ids out of the
check modules' own source and asserts the two sets are equal in both directions: a new rule
that never reached the catalogue fails, and so does a catalogue entry no check can emit.

### 3. Severity is a claim about confidence, not importance

The catalogue carries an `advisoryReason` for every warning that is a heuristic:

- `console` — "a CLI, a script and a test legitimately print"
- `commented-out-code` — "prose about code can look like code"
- `restated-comment` — "word overlap is a heuristic, not a reading"
- `file-length` — "a generated or data-heavy file is legitimately long"
- `imperative` — "English verb shapes overlap"
- `no-body` — "a small change can be self-evident"

The stated logic, in the file's own header comment, is that a rule which reads a legitimate
choice as a defect often enough stays advisory, because gating it teaches people to route
around the gate. A rule that blocks has to be one where a false positive is rare enough
that a suppression feels reasonable rather than routine.

`--strict` promotes every warning to blocking, for a project that has decided it disagrees.

## How a staged change becomes a verdict

```
commit-gate check --staged
  └─ bin: parseArguments → repositoryRoot(dir) → loadConfig(root)
       └─ commands.runCheck
            ├─ commands.changeFindings
            │    ├─ git.diffFor({ root, staged: true })     git diff --cached --unified=0
            │    ├─ git.addedLines(diff)                    Map<path, {line,text}[]>
            │    ├─ git.fileLineCount(path, root, source)   the index, a revision, or disk
            │    └─ rules.checkFiles(files, config, counts)
            │         ├─ paths.isIgnored           generated? fixture? skip the file
            │         ├─ secrets.checkSecrets      every file, code or not
            │         ├─ comments.checkComments    code extensions only
            │         └─ rules.checkCode           code extensions only
            ├─ baseline.loadBaseline(root)         commit-gate-baseline.json → Set of keys
            ├─ baseline.applyBaseline              → { kept, skipped }
            └─ report.renderReport(kept, options, skipped)
                 → { text, blocked }
  └─ bin: console.log(text); process.exitCode = blocked ? 1 : 0
```

Two properties fall out of the split:

- **Every command function is pure and silent.** `runCheck` and friends return
  `{ text, blocked }`; only `bin/commit-gate.mjs` calls `console.log` or sets an exit code.
  The unit tests call `runRules()` and `renderReport()` directly with no terminal and no
  repository.
- **`fileLineCount` reads whichever revision the check is about.** `commands.contentSourceFor`
  maps the options to it: `--staged` means the index (`git show :path`), `--range a...b` means
  `b` (`git show b:path`), and everything else — a bare `git diff`, or a `--range` naming a
  single revision — means the files on disk, which is what git compared against. A file that
  cannot be read at that revision counts as nothing to measure, and `file-length` stays quiet
  rather than failing the run.

## Finding the false positives before they find you

Most of the interesting code is defensive. Each of these exists because the naive version
of the rule misfires:

**Comment lines are invisible to the code rules.** `checkCode` starts each iteration with
`if (commentBody(path, text) != null) continue;`. Without it, a comment reading "we call
`console.log` in the CLI" is a `console` finding, and — worse — the checker flags the text
of its own suppression examples and its own documentation. A unit test pins exactly this.

**`#` is a comment only where `#` is a comment.** `commentBody` picks `HASH_COMMENT` for
`.py|.rb|.sh|.ya?ml|.tf|.pl` and `SLASH_COMMENT` everywhere else, rather than accepting
both. A `#` line inside a JavaScript template literal (shell, a Dockerfile, a CSS colour)
is not a comment, and treating it as one puts comment rules on arbitrary strings.

**A one-line `if` is only a finding where braces mean something.** `BRACE_LANGUAGES`
excludes Python and Ruby, where a single-line conditional is idiomatic rather than a
defect. And `UNBRACED_CONTROL` alone is not trusted: its `.*` is greedy, so
`if (!x) { foo(); }` matches it (the `.*` runs to the `)` of `foo()`). The rule therefore
requires `UNBRACED_CONTROL.test(text) && !BRACED_CONTROL.test(text)` — the second pattern
backtracks to find the brace and vetoes the first.

**A secret has to look like a credential.** The `inline-credential` pattern is the one that
would otherwise fire constantly, so it carries three lookahead constraints: at least 16
characters, at least one digit, and a character class of `[A-Za-z0-9+/=_.]` that excludes
hyphens and spaces. A configuration line like `key: "some-ui-identifier"` is hyphenated and
digit-free, so it is not reported. Only the first matching pattern per line produces a
finding — several patterns hitting the same key is still one key.

**Only the first line of a comment block is judged.** `continuesAComment` skips a comment
line whose immediate predecessor is also a comment. A wrapped paragraph's later lines are
sentence fragments, and a fragment beginning "changed the retry count" reads as a changelog
comment even when the sentence above it made the meaning clear. The exception is a
directive: `isDirective` means a `gate-ignore-next-line` comment starts nothing, so the
line under it is still a block's first line.

**Restatement is measured against split identifiers, minus filler.** `restatementRatio`
tokenises the comment plainly, but tokenises the code line with `splitIdentifiers: true` —
`getCustomer` becomes `get customer`, `retry_count` becomes `retry count`. Otherwise "get
the customer" above `const customer = getCustomer(token)` would show almost no overlap,
which is the single most common restated comment there is. Ten filler words (`the`, `and`,
`for`, `this`, `that`, `with`, `from`, `into`, `get`, `set`) are dropped from both sides,
tokens must be at least three characters, and the denominator is the comment's word count,
so a short comment fully echoed scores 1.0. The threshold is `restatementOverlap`,
default 0.6, and the rule only fires when the next line is **not** itself a comment.

**"Looks like code" is a shape, not a keyword.** `CODE_IN_COMMENT` is anchored patterns —
`^const|let|var`, `^function`, `^class`, `^if|for|while (`, `^import|export`, a `return`
ending in a semicolon, a fat arrow, `) {` at end of line, and an assignment or call ending
in a semicolon. The file's own comment gives the reason: a keyword alone is not enough,
because "for this long" opens a sentence, not a loop.

**Generated code is nobody's to hand-clean.** `DEFAULTS.ignorePaths` covers
`node_modules`, `dist`, `build`, `vendor`, `*.min.js`, `*.gen.*`, `generated`,
`__generated__`, `_generated`, `*.pb.*` and `*_pb2.py`. `globToRegExp` implements just
enough glob for this: `**/` becomes `(?:.*/)?` so it matches zero directories as well as
many, `**` becomes `.*`, and `*` becomes `[^/]*`. Regex metacharacters are escaped between
those two substitutions, via two private placeholder characters.

**Imperative mood has an exception list.** `looksImperative` strips a Conventional Commits
prefix, then rejects a first word matching `-ed`, `-ing` or `-s`. Six English verbs are
imperative and end in `s` anyway — `address`, `process`, `bless`, `express`, `focus`,
`pass`, `dismiss` — so `IMPERATIVE_EXCEPTIONS` holds them. The rule is still a warning,
because the list is not complete and cannot be.

**`console` is allowed where printing is the job.** `allowsConsole` matches a path *segment*
against `consoleAllowedIn` (`test`, `tests`, `spec`, `scripts`, `bin`, `cli`) and also
matches `.segment.` inside a filename, so both `scripts/seed.ts` and `src/a.test.ts` are
exempt. Only `console.log`, `.debug` and `.dir` are matched at all; `console.error` and
`console.warn` are left alone as legitimate output. `CONSOLE_LANGUAGES` then limits the rule
to JavaScript and TypeScript, the way `TYPESCRIPT` limits `any` and `BRACE_LANGUAGES` limits
`one-line-if`: `console` is a JavaScript object, so a workflow step running
`node -e "console.log(...)"` is a script doing its job, not application logging.

## Suppression

Any rule can be wrong, so any finding can be silenced by name and with a reason:

```ts
const client: any = sdk();                      // gate-ignore: any the SDK ships no types
// gate-ignore-next-line: any the SDK ships no types
const client: any = sdk();
```

`suppression.suppressedRule(line, previous)` returns `{ rule, reason }` or `null`. Both
call sites then build `const allow = (rule) => suppressed?.rule === rule`, so **a
suppression silences exactly the rule it names**. A `gate-ignore: any` on a line that also
has a `debugger` still reports the `debugger`; a unit test pins that.

Three decisions worth naming:

- **Two forms, because of formatters.** A trailing directive is clearer, but a formatter
  that re-wraps a long line can move it off its line. The next-line form is the escape
  hatch that survives reformatting.
- **The next-line form reaches exactly one line**, checked by line number, never by array
  position — see idea 1. A directive at line 11 does not silence line 900 just because
  `--unified=0` put them next to each other in the array.
- **The reason is required, and `suppression-reason` enforces it.** `missingReason` reports
  a directive that names a rule and says nothing else, so a suppression stays a sentence
  someone had to write rather than a token they could paste. The directive still silences
  its rule: re-reporting the silenced finding on top would bury the one thing this says.
  Every line reaches exactly one of the two call sites — `checkCode` skips comment-only
  lines, `checkComments` sees only those — so a directive is reported once, where it is
  written.

## The baseline

`commit-gate baseline` is for adopting the gate on a repository that already violates it.
It scans the whole tracked tree — not a diff — and records every finding in
`commit-gate-baseline.json`.

The whole-tree scan uses `git.allLinesOf`, which tries `:path` (the index) and then
`HEAD:path`, so a file staged but never committed is still scanned. Every line counts as
present rather than as added, which is the opposite of what `check` does, and is why the
two paths need different git functions rather than one. Binary paths are skipped by
extension in `commands.wholeTreeFindings`.

**Entries are keyed on rule and path, never line** (`baseline.keyFor` →
`"rule::path"`). A line number would un-baseline a finding the moment anything above it
moved, which would turn an unrelated edit into a wall of newly-blocking findings.

The trade-off is that the key is coarse: baselining one `any` in a file accepts every `any`
in that file, including ones added later. The mitigating rule is `refusedRecordings`:

```
commit-gate: refusing to record findings in files this change touches:
  any  src/touched.ts
Fix them, or suppress one with a reason so the exception is reviewed.
```

`runBaseline` diffs the staged change, and if any whole-tree finding lands in a file that
change touches, it prints that list and returns `blocked: true` without writing anything.
**There is deliberately no `--force` for this.** The header comment says it plainly:
recording a finding in a file you are currently editing buries the thing the gate exists to
catch. The escape is a suppression, which lands in the diff and gets reviewed.

`staleEntries` reports keys in the file that nothing violates any more, and rewriting drops
them, so the file shrinks as debt is paid instead of rotting. `--no-baseline` ignores the
file entirely.

## Rendering

`report.renderReport` picks one of three renderers and returns `{ text, blocked }`, where
`blocked = errors > 0 || (strict && warnings > 0)`.

- **`renderText`** — two lines per finding: `severity  path:line  message`, then an indented
  `→ fix  [rule]`. The rule name in brackets is there so the next step (a suppression or a
  config change) needs no lookup.
- **`renderJson`** — `{ blocked, errors, warnings, baselineSkipped, findings,
  judgementChecklist }`. `findings` is the raw `Finding` array, unmapped.
- **`renderForAgent`** — a fix list, then the judgement checklist under the heading "Then
  judge these yourself, because no checker can".

`JUDGEMENT_CHECKLIST` is the design statement of the tool, and it appears in both the JSON
and the agent output:

```
- Do the names say what things are, so the comments are not needed?
- Does every remaining comment explain a reason the code cannot?
- Does the commit subject name the one thing this change does?
- Does the commit body say why, not what the diff already shows?
- Does each pull-request section tell a reviewer what to look at?
```

Whether a name carries its meaning, and whether a comment earns its place, are the two
things the tool most wants and least can check. Rather than approximate them with a regex
and be wrong noisily, the code states them as questions and hands them to whoever reviews
next. The `restated-comment` warning is the closest it comes, and it is deliberately a
warning.

## Commit messages and pull-request bodies

Both are text checks with no git involvement beyond fetching the text.

`message.splitMessage` drops lines starting with `#` — git's own template commentary —
before splitting subject from body, then trims. `checkMessage` returns early on an empty
subject, because every later rule would be noise. `body-file-list` needs **three** matching
list lines before it fires, so a body that legitimately mentions a couple of files is not
flagged. Body findings report `index + 3` as the line number, a nominal position assuming
subject on line 1 and a blank on line 2.

`pr.sectionsOf` accepts markdown headings (`#` to `####`) and bold headings (`**Name**`),
because PR templates use both. Matching a required section is substring and
case-insensitive (`names[i].includes(required.toLowerCase())`), so "Testing notes" satisfies
"Testing". An empty section is content that is empty once `-`, `*` and whitespace are
stripped — a heading followed by an empty bullet is still empty.

`duplicated-narrative` compares the PR body against `HEAD`'s commit message using
`longestSharedRun`, which looks for a shared substring of at least 60 characters, sampling
lengths and start offsets in steps of 10 over the first 400 characters. The coarse stepping
is the point: it is cheap and it only needs to catch wholesale copying, not paraphrase. It
can miss a shared run that falls between samples.

## Configuration

`commit-gate.json` at the repository root, merged over `DEFAULTS` by `config.merge`: a
recursive merge for plain objects, replacement for arrays and scalars. Replacing arrays
rather than concatenating them means a project that sets `ignorePaths` gets exactly what it
wrote and does not have to fight the defaults. Absent file means defaults; malformed JSON
throws a named error rather than silently falling back — a config that is not being read is
worse than one that refuses to load.

`loadConfig` returns the merged configuration. It used to return `{ config, source }`; the
source was never read, and a field nothing consumes is a field that drifts.

## Errors and exit codes

| Where | Becomes |
|---|---|
| `git.git()` | `GitError`, with git's captured stderr. stderr is piped, not inherited, so a probe that misses does not print git's fatal line to the terminal |
| `repositoryRoot` fails | `commit-gate: <dir> is not inside a git repository.`, exit 3 |
| Unknown option, unknown command, missing option value, `pr` without `--body` | `UsageError` → exit 2 |
| `GitError` matching `unknown revision|bad revision` | `<range> does not resolve to a commit range in this repository.`, exit 2 |
| Malformed `commit-gate.json` or `commit-gate-baseline.json` | a named error naming the file |
| Findings that block | exit 1 |

`diffFor` always appends `--` before the revision arguments. Without the separator, git
reads an unresolvable range as a pathspec and complains in those terms; with it, an unknown
revision is reported as an unknown revision, which is the message the CLI can then
translate.

`trackedFiles` uses `git ls-files -z`, because git C-quotes any path containing non-ASCII or
control characters, and a quoted path resolves to nothing.

## Install

`commit-gate install` writes a `pre-commit` hook (`commit-gate check --staged`), a
`commit-msg` hook (`commit-gate message "$1"`), `.claude/skills/commit-gate/SKILL.md`, and
appends `AGENT_SECTION` to `CLAUDE.md` and `AGENTS.md` if either exists. Nothing is
overwritten without `--force`, and `appendSection` additionally skips a file that already
contains `commit-gate check --staged`, so re-running is safe.

Both the hooks and the agent instructions are written, and `agents/README.md` states why:
instructions are advice, a hook is a wall, and agents skip advice under pressure the same
way people do.

The hook scripts invoke `commit-gate` from `PATH`, so the tool has to be installed globally
for them to work.

## Testing

| File | Covers |
|---|---|
| `test/unit.test.mjs` | 45 `node:test` cases over the rules, suppression, baselines, config merging, globs and rendering. No git and no repository; the only files read are this project's own sources, by the two tests that keep the catalogue and the README in step |
| `test/cli.test.sh` | 55 assertions against real temporary repositories: real staged changes, real hooks, real exit codes |

```bash
npm test            # unit, then end to end
npm run test:unit   # node --test test/unit.test.mjs
npm run test:cli    # bash test/cli.test.sh
```

No mocks and no test framework beyond `node:test`. The unit tests build line arrays by hand
(`lines("...")`), which is exactly the shape `addedLines` produces, so the rules are tested
on their real input without a repository. One unit test feeds `addedLines` a literal diff
to pin the hunk-header arithmetic.

The shell suite creates several repositories — a clean one, one with legacy violations
committed at back-dated timestamps, one for next-line suppressions, one for `--strict` —
and drives `bin/commit-gate.mjs` as a subprocess, so what is verified is the installed entry
point rather than an import of the library. Its assertions are substring checks on output
plus exact exit-code checks.

The gap: the rules are tested on synthetic lines, not on the diffs of real-world files, so
the false-positive defences are verified against the cases someone thought of.

## Where to change things

| To change | Edit |
|---|---|
| A code rule's pattern | `lib/rules.mjs` — the constants at the top |
| What counts as a comment, or as code inside one | `lib/comments.mjs` — `HASH_COMMENT_LANGUAGES`, `CODE_IN_COMMENT`, `CHANGELOG_WORDS`, `CHANGELOG_PHRASES` |
| The restatement heuristic | `lib/comments.mjs` — `tokens`, `FILLER_WORDS`, `restatementRatio`; the threshold is `comments.restatementOverlap` |
| Secret shapes | `lib/secrets.mjs` — `SECRET_PATTERNS` |
| Which files are skipped | `lib/config.mjs` — `ignorePaths`, `fixturePaths`; the matcher is `lib/paths.mjs` |
| A new rule | Add it in `rules`, `comments`, `message` or `pr`, **and** add it to `RULES` in `lib/catalogue.mjs` or `commit-gate rules` will not list it |
| A default or a threshold | `lib/config.mjs` — `DEFAULTS` |
| Output shape | `lib/report.mjs` — `renderText`, `renderJson`, `renderForAgent` |
| The judgement checklist | `lib/report.mjs` — `JUDGEMENT_CHECKLIST`; it appears in JSON and agent output |
| A new command | `lib/commands.mjs` for the logic, `COMMANDS` in `bin/commit-gate.mjs` for dispatch, `lib/help.mjs` for the help |
| A new flag | `parseArguments` in `bin/commit-gate.mjs`, and `lib/help.mjs` |
| What `install` writes | `lib/install.mjs` — `PRE_COMMIT`, `COMMIT_MSG`, `SKILL`, `AGENT_SECTION`; keep `agents/` in step |
| Suppression syntax | `lib/suppression.mjs` — `TRAILING`, `NEXT_LINE` |

## Known gaps

Things the code does not do, which are worth knowing before trusting it:

- **`runPullRequest` resolves `--body` relative to the process's working directory**, not
  to the repository root, so `--dir` plus a relative body path reads from the wrong place.
  `runMessage` no longer does this; `pr` still does.

## Deliberate omissions

Not oversights:

- **No dependencies.** Node 22+ and git. A pre-commit hook that has to install a tree
  before it can run is a pre-commit hook people uninstall.
- **No parser or AST.** Everything is line-based regular expressions. The README states the
  cost outright: a comment split across lines, or code in an unusual layout, can slip past.
  It is a gate, not a type checker, and it is not a replacement for a linter.
- **No naming rules.** The tool refuses to guess whether a name is good, and prints the
  question instead.
- **No auto-fix.** The output names the file, the line and the remedy, and leaves the edit
  to whoever is holding the change — which, given `--agent`, is often an agent that can
  make it.
- **No severity beyond error and warn.** A third level would be a way to add rules nobody
  acts on.
- **No `--force` on `baseline`.** Structural, for the reason given above.
- **No network, no telemetry, no cache.** Every run reads git and the working tree fresh.
