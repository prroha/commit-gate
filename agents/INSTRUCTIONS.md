# commit-gate instructions for an AI coding agent

Paste into `CLAUDE.md`, `AGENTS.md`, `.cursorrules` or a system prompt. `commit-gate install` adds this for you.

## Before committing

Run `commit-gate check --staged --agent` and act on what it says:

- Fix every error it reports, and the warnings unless there is a reason not to.
- Then judge for yourself the things it cannot check: whether names carry the
  meaning, whether each remaining comment explains a reason the code cannot,
  and whether the commit subject names the one thing this change does.
- Keep the reasoning in the commit body. A pull-request body says what to
  review: Description, Motivation, Testing, Rollout, each short and filled in.
- Check a message with `commit-gate message <file>` and a pull-request body
  with `commit-gate pr --body <file>`.

## Reading the output

- `error` blocks the commit. Fix it.
- `warn` does not block, but fix it unless you can say why not.
- `[rule-name]` at the end of a line is the rule, for a suppression or a config change.

## Suppressing a finding

Only with a reason, which the gate requires, and only for one rule:

```ts
const client: any = sdk(); // gate-ignore: any the SDK ships no types
```

## Rules for you

- Never raise a threshold in `commit-gate.json` to make a check pass.
- Never add a baseline entry for code you just wrote; baselines are for code that predates the gate.
- The checklist it prints is yours to answer, not to skip: names first, then whether each remaining comment gives a reason the code cannot.
