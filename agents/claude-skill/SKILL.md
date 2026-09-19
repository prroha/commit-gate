---
name: commit-gate
description: Use before committing or opening a pull request, to check staged changes against the project's standards and to write the commit message and PR body. Also use when asked to clean up a change before review.
---

# Gating a change before it lands

## 1. Check what is staged

```bash
commit-gate check --staged --agent
```

Fix every error. Fix warnings unless you can say why not.

## 2. Judge what the checker cannot

- Do the names say what things are, so comments are unnecessary?
- Does every remaining comment give a reason the code cannot?
- Is anything left that only made sense while writing it?

## 3. Write the message

One subject line naming the one thing this change does, imperative mood, no
period. A body only when the reason is not obvious, saying **why**, never
listing files.

```bash
commit-gate message .git/COMMIT_EDITMSG
```

## 4. Write the pull-request body

Fill every section and keep each short: Description, Motivation, Testing,
Rollout. Reasoning stays in the commit; the body tells a reviewer what to look
at.

```bash
commit-gate pr --body pr.md
```

## Rules

- Never raise a threshold in `commit-gate.json` to make a check pass.
- Never suppress a finding without a reason: `// gate-ignore: rule why`.
- A baseline exists for code that predates the gate, not for code you just wrote.
