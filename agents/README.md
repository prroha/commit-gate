# Using commit-gate with AI coding agents

An agent that runs the gate before committing produces changes a human can review. One that doesn't leaves debug code, narrating comments and empty PR sections for the reviewer to find.

| File | What to do with it |
|---|---|
| [`INSTRUCTIONS.md`](INSTRUCTIONS.md) | Paste into `CLAUDE.md`, `AGENTS.md`, `.cursorrules` or a system prompt |
| [`claude-skill/SKILL.md`](claude-skill/SKILL.md) | Copy to `.claude/skills/commit-gate/SKILL.md` |

`commit-gate install` writes both for you, plus the git hooks, so the gate runs whether or not the agent remembers.

## Claude Code

```bash
npm install -g github:prroha/commit-gate
commit-gate install
```

Let it run without a prompt each time, in `.claude/settings.json`:

```json
{ "permissions": { "allow": ["Bash(commit-gate:*)"] } }
```

## Why the hooks matter as well as the instructions

Instructions are advice; a `pre-commit` hook is a wall. Agents skip advice under pressure, the same way people do. Install both.
