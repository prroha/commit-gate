# commit-gate

**Stop shipping the things nobody wants to review.** commit-gate checks a change before it lands — leftover debug code, committed secrets, comments that describe a change instead of the code, a vague commit subject, a half-empty pull-request body — and tells an AI agent exactly what is left for it to judge.

```
$ commit-gate check --staged
  error  src/refund.ts:1   comment describes a change, not the code: "Updated to use the new client"
         → say what is true now, or delete it; the diff already records the change  [changelog-comment]
  error  src/refund.ts:2   `any` defeats the type checker
         → use `unknown` and narrow it, or name the real type  [any]
  error  src/refund.ts:3   single-line control statement without braces
         → use braces and a newline  [one-line-if]
  warn   src/refund.ts:4   comment repeats the line below it
         → delete it, or replace it with the reason the code is this way  [restated-comment]
  error  src/refund.ts:8   looks like a committed secret (vendor-key)
         → move it to an environment variable or a secrets manager, then rotate it  [secret]

commit-gate: blocked: 3 errors, 2 warnings
```

## Why

AI agents write a lot of code quickly, and the boring standards are the first casualty: a comment that narrates the edit, a `debugger` left in, a commit message that says "updated files", a pull-request body with four empty headings. Reviewers then spend their attention on housekeeping instead of on whether the change is right.

commit-gate makes the housekeeping automatic and honest about its limits: it checks what a machine can check, and hands the rest to whoever reviews next as a short checklist rather than pretending a regex can judge a variable name.

## Install

Needs **Node 22+** and git. No dependencies. Runs on macOS, Linux and Windows.

```bash
npm install -g github:prroha/commit-gate
cd your-project
commit-gate install
```

`install` writes a `pre-commit` hook, a `commit-msg` hook, a Claude Code skill, and a short section in your `CLAUDE.md` or `AGENTS.md` so agents run it too. It never overwrites an existing file without `--force`.

**Adopting it on an existing codebase?** Record what's already there, so only new problems block:

```bash
commit-gate baseline
```

## Commands

```bash
commit-gate check --staged            # what a pre-commit hook runs
commit-gate check --range main...HEAD # a whole branch, before opening a PR
commit-gate message .git/COMMIT_EDITMSG
commit-gate message HEAD              # the commit you just made
commit-gate pr --body pr.md
commit-gate baseline                  # accept today's findings; block new ones
commit-gate rules                     # every rule, its severity, and why
commit-gate install                   # hooks + agent instructions
```

| Option | Meaning |
|---|---|
| `--staged` | Only staged changes |
| `--range <a...b>` | A commit range instead |
| `--strict` | Warnings block too |
| `--json` | Findings as JSON, with the judgement checklist |
| `--agent` | A block for an AI agent: what to fix, then what to judge |
| `--no-baseline` | Ignore the baseline file |
| `--dir <path>` | Run against another repository |
| `--force` | Overwrite existing hooks (`install`) |

Exit codes: `0` clean · `1` blocked · `2` usage · `3` not a git repository.

## What it checks

**Only the lines a change adds**, so a one-line fix in a legacy file isn't blocked by the file's history.

### Code
| Rule | Severity |
|---|---|
| `secret` — keys, tokens, inline credentials, private keys | error |
| `debugger` — left in | error |
| `any` — in TypeScript | error |
| `one-line-if` — control statement without braces | error |
| `console` — logging in JavaScript or TypeScript (test, script and CLI paths exempt) | warn |
| `file-length` — over 200 lines | warn |
| `suppression-reason` — a `gate-ignore` that never says why | error |

### Comments
| Rule | Severity |
|---|---|
| `changelog-comment` — "Updated to…", "we just…", "for now" | error |
| `commented-out-code` — code hiding in a comment | warn |
| `restated-comment` — the comment repeats the line below, `getCustomer` included | warn |

### Commit message
`subject-length` (72), `subject-period`, `imperative` ("add", not "added"), `no-body`, `body-line-length`, `body-file-list` (the body lists files the diff already shows), optional `conventional`, and `forbidden-line` for lines you never want committed.

### Pull-request body
`missing-section` and `empty-section` against your required sections (Description, Motivation, Testing, Rollout by default), `long-section` when one turns into an essay, and `duplicated-narrative` when the body repeats the commit message — reasoning belongs in the commit; the body tells a reviewer what to look at.

## What it deliberately does not check

**Whether your names are good, and whether a comment earns its place.** No deterministic rule can judge that, so instead of guessing, every output ends with the checklist:

```
Then judge these yourself, because no checker can:
- Do the names say what things are, so the comments are not needed?
- Does every remaining comment explain a reason the code cannot?
- Does the commit subject name the one thing this change does?
- Does the commit body say why, not what the diff already shows?
- Does each pull-request section tell a reviewer what to look at?
```

That is the part an agent, or a person, has to do. commit-gate makes sure it is the *only* part left.

## For AI coding agents

This is the tool's main use: an agent that runs the gate before committing produces changes a human can actually review.

```bash
commit-gate check --staged --agent
```

Drop-ins live in [`agents/`](agents/), and `commit-gate install` writes the Claude Code skill for you. The short version to paste anywhere:

```markdown
Before committing, run `commit-gate check --staged --agent`, fix what it reports,
then judge the checklist it prints. Keep the reasoning in the commit body; fill
every pull-request section and keep each short.
```

## Configuration

Optional `commit-gate.json` at the repository root. Every threshold and rule can change:

```json
{
  "code": { "maxFileLines": 300, "forbidConsole": false },
  "comments": { "restatementOverlap": 0.7 },
  "message": { "requireConventional": true, "maxSubjectLength": 50 },
  "pr": { "requiredSections": ["Summary", "Testing"] },
  "ignorePaths": ["**/generated/**"]
}
```

## Suppressions

Any rule can be wrong. Silence one, with a reason:

```ts
const client: any = sdk(); // gate-ignore: any the SDK ships no types
```

Or on the line above, where a formatter would re-break a trailing comment:

```ts
// gate-ignore-next-line: any the SDK ships no types
const client: any = sdk();
```

A suppression names **one** rule and **requires** a reason, so it silences that rule only and the next reader knows why. Leave the reason out and the gate reports `suppression-reason` in its place. A next-line directive reaches the line directly below it, nothing further.

## Baselines

`commit-gate baseline` scans the tracked tree and records today's findings by rule and path in `commit-gate-baseline.json`. Those stop blocking; anything new blocks.

**It refuses to record findings in any file your current change touches**, and exits 1 listing them. There is no `--force`: a baseline is for code that predates the gate, not for code you just wrote. The escape is a suppression, which lands in the diff and gets reviewed.

Entries nothing violates any more are dropped when you re-run it, so the file shrinks as you clean up. Delete it when it's empty.

## Tests

```bash
npm test            # unit tests, then end to end
npm run test:unit   # 45 tests on the rules, no git
npm run test:cli    # 55 tests: real repositories, real staged changes, real hooks
```

## Limitations

- **Line-based, not a parser.** A comment split across lines, or code in an unusual layout, can slip past. It is a gate, not a type checker; keep your linter too.
- **The restatement check is a heuristic**, which is why it's a warning rather than an error, and why `restatementOverlap` is configurable.
- **Secrets detection catches shapes it knows.** Use a dedicated scanner if that's your main concern. The value must look like a credential, so a short or hyphenated string is not reported.

## License

MIT
