// Wiring the gate in, so nobody has to remember to run it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PRE_COMMIT = `#!/bin/sh
# Installed by commit-gate.
commit-gate check --staged || exit 1
`;

const COMMIT_MSG = `#!/bin/sh
# Installed by commit-gate.
commit-gate message "$1" || exit 1
`;

const AGENT_SECTION = `
## Before committing

Run \`commit-gate check --staged --agent\` and act on what it says:

- Fix every error it reports, and the warnings unless there is a reason not to.
- Then judge for yourself the things it cannot check: whether names carry the
  meaning, whether each remaining comment explains a reason the code cannot,
  and whether the commit subject names the one thing this change does.
- Keep the reasoning in the commit body. A pull-request body says what to
  review: Description, Motivation, Testing, Rollout, each short and filled in.
- Check a message with \`commit-gate message <file>\` and a pull-request body
  with \`commit-gate pr --body <file>\`.
`;

const SKILL = `---
name: commit-gate
description: Use before committing or opening a pull request, to check staged changes against the project's standards and to write the commit message and PR body. Also use when asked to clean up a change before review.
---

# Gating a change before it lands

## 1. Check what is staged

\`\`\`bash
commit-gate check --staged --agent
\`\`\`

Fix every error. Fix warnings unless you can say why not.

## 2. Judge what the checker cannot

- Do the names say what things are, so comments are unnecessary?
- Does every remaining comment give a reason the code cannot?
- Is anything left that only made sense while writing it?

## 3. Write the message

One subject line naming the one thing this change does, imperative mood, no
period. A body only when the reason is not obvious, saying **why**, never
listing files.

\`\`\`bash
commit-gate message .git/COMMIT_EDITMSG
\`\`\`

## 4. Write the pull-request body

Fill every section and keep each short: Description, Motivation, Testing,
Rollout. Reasoning stays in the commit; the body tells a reviewer what to look
at.

\`\`\`bash
commit-gate pr --body pr.md
\`\`\`

## Rules

- Never raise a threshold in \`commit-gate.json\` to make a check pass.
- Never suppress a finding without a reason: \`// gate-ignore: rule why\`.
- A baseline exists for code that predates the gate, not for code you just wrote.
`;

function writeHook(root, name, contents, force) {
  const path = join(root, ".git", "hooks", name);
  if (existsSync(path) && !force) {
    return { path, written: false, reason: "exists" };
  }
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  return { path, written: true };
}

function appendSection(root, file) {
  const path = join(root, file);
  if (!existsSync(path)) {
    return { path, written: false, reason: "not found" };
  }
  const current = readFileSync(path, "utf8");
  if (current.includes("commit-gate check --staged")) {
    return { path, written: false, reason: "already mentions commit-gate" };
  }
  writeFileSync(path, `${current.trimEnd()}\n${AGENT_SECTION}`);
  return { path, written: true };
}

export function install(root, { force = false, agent = true } = {}) {
  const results = [
    writeHook(root, "pre-commit", PRE_COMMIT, force),
    writeHook(root, "commit-msg", COMMIT_MSG, force),
  ];

  if (agent) {
    const skillDirectory = join(root, ".claude", "skills", "commit-gate");
    mkdirSync(skillDirectory, { recursive: true });
    const skillPath = join(skillDirectory, "SKILL.md");
    if (!existsSync(skillPath) || force) {
      writeFileSync(skillPath, SKILL);
      results.push({ path: skillPath, written: true });
    } else {
      results.push({ path: skillPath, written: false, reason: "exists" });
    }
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      results.push(appendSection(root, file));
    }
  }
  return results;
}

export { AGENT_SECTION, SKILL };
