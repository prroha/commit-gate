// The help text, kept out of the command wiring.

export const HELP = `commit-gate — check a change before it lands

Usage: commit-gate [command] [options]

Commands:
  check                  check the change (default; --staged in a hook)
  message <file|HEAD>    check a commit message
  pr --body <file>       check a pull-request body
  baseline               record current findings as accepted, so only new ones block
  rules                  list every rule, its severity, and why a rule is advisory
  install                add git hooks, a Claude Code skill and an agent section

Options:
  --staged               only what is staged (what a pre-commit hook wants)
  --range <a...b>        check a branch, e.g. main...HEAD
  --strict               warnings block too
  --json                 machine-readable findings
  --agent                a block for an AI agent: what to fix, then what to judge
  --no-baseline          ignore the baseline file
  --dir <path>           run against another repository
  --force                overwrite existing hooks (install)
  -v, --version          print the version
  -h, --help             this help

What it checks mechanically:
  secrets, debugger and console left in, \`any\`, single-line control statements,
  long files, comments that describe a change or repeat the code, commented-out
  code, commit subject and body shape, and pull-request sections.
  Run \`commit-gate rules\` for the list.

What it leaves to you: whether the names carry the meaning. No checker can
judge that, so --agent prints it as a checklist instead of pretending.

Suppress one finding with a reason, which is required, trailing or on the line above:
  const client: any = sdk(); // gate-ignore: any the SDK ships no types
  // gate-ignore-next-line: any the SDK ships no types
Exit codes: 0 clean · 1 blocked · 2 usage · 3 not a git repository`;

