#!/usr/bin/env bash
# End-to-end tests: real git repositories, real staged changes, the real CLI.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$(dirname "$HERE")/bin/commit-gate.mjs"
WORK="$(mktemp -d)"

pass=0
fail=0

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

check() {
  local name="$1" needle="$2" actual="$3"
  case "$actual" in
    *"$needle"*) printf "  ok    %s\n" "$name"; pass=$((pass + 1)) ;;
    *) printf "  FAIL  %s\n        expected to contain: %s\n        got: %s\n" "$name" "$needle" "$actual"; fail=$((fail + 1)) ;;
  esac
}

check_missing() {
  local name="$1" needle="$2" actual="$3"
  case "$actual" in
    *"$needle"*) printf "  FAIL  %s\n        should not contain: %s\n" "$name" "$needle"; fail=$((fail + 1)) ;;
    *) printf "  ok    %s\n" "$name"; pass=$((pass + 1)) ;;
  esac
}

check_code() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf "  ok    %s\n" "$name"; pass=$((pass + 1))
  else
    printf "  FAIL  %s (expected exit %s, got %s)\n" "$name" "$expected" "$actual"; fail=$((fail + 1))
  fi
}

commit_at() {
  local repo="$1" days_ago="$2" message="$3"
  local stamp
  stamp="$(date -u -v-"${days_ago}"d +"%Y-%m-%dT%H:%M:%S" 2>/dev/null \
    || date -u -d "${days_ago} days ago" +"%Y-%m-%dT%H:%M:%S")"
  GIT_AUTHOR_DATE="$stamp" GIT_COMMITTER_DATE="$stamp" git -C "$repo" commit -q -m "$message"
}

REPO="$WORK/repo"
mkdir -p "$REPO/src"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Test"
printf '# project\n' > "$REPO/README.md"
git -C "$REPO" add -A
git -C "$REPO" commit -q -m "add a readme

The repository needs somewhere to say what it is."

echo "a clean change"
cat > "$REPO/src/charge.ts" <<'CODE'
export function chargeCard(token: string, amountInCents: number) {
  if (amountInCents <= 0) {
    throw new Error("amount must be positive");
  }
  return provider.charge(token, amountInCents);
}
CODE
git -C "$REPO" add -A
check "passes a clean change" "clean" "$("$GATE" check --staged --dir "$REPO")"
"$GATE" check --staged --dir "$REPO" >/dev/null 2>&1
check_code "and exits 0" 0 "$?"

echo "a messy change"
cat > "$REPO/src/messy.ts" <<'CODE'
// Updated to use the new client
export function refund(token: any, amount: number) {
  if (!token) return null;
  // get the customer
  const customer = getCustomer(token);
  console.log("refunding", amount);
  debugger;
  const secret = "sk_live_51H8xQ2abcdefghij";
  // const old = legacyRefund(token);
  return customer;
}
CODE
git -C "$REPO" add -A
messy="$("$GATE" check --staged --dir "$REPO" 2>&1)"
check "flags a changelog comment" "changelog-comment" "$messy"
check "flags any" "[any]" "$messy"
check "flags a one-line if" "one-line-if" "$messy"
check "flags a restated comment" "restated-comment" "$messy"
check "flags console" "[console]" "$messy"
check "flags debugger" "[debugger]" "$messy"
check "flags a committed secret" "committed secret" "$messy"
check "flags commented-out code" "commented-out-code" "$messy"
check "says it is blocked" "blocked" "$messy"
"$GATE" check --staged --dir "$REPO" >/dev/null 2>&1
check_code "and exits 1" 1 "$?"

echo "output formats"
check "json is machine-readable" '"blocked": true' "$("$GATE" check --staged --dir "$REPO" --json 2>/dev/null)"
if command -v python3 >/dev/null 2>&1; then
  parsed="$("$GATE" check --staged --dir "$REPO" --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(str(data['errors']) + ',' + str(len(data['judgementChecklist'])))
")"
  check "json carries counts and the judgement checklist" "5,5" "$parsed"
fi
agent="$("$GATE" check --staged --dir "$REPO" --agent 2>/dev/null)"
check "the agent block lists fixes" "Fix these" "$agent"
check "and what only a reviewer can judge" "judge these yourself" "$agent"

echo "suppression"
sed -i.bak 's|export function refund(token: any, amount: number) {|export function refund(token: any, amount: number) { // gate-ignore: any the SDK ships no types|' "$REPO/src/messy.ts"
rm -f "$REPO/src/messy.ts.bak"
git -C "$REPO" add -A
check_missing "a suppression silences its own rule" "[any]" "$("$GATE" check --staged --dir "$REPO" 2>&1)"
check "and leaves the others" "debugger" "$("$GATE" check --staged --dir "$REPO" 2>&1)"

echo "baseline"
check "refuses to record findings in a file this change touches" "refusing to record" \
  "$("$GATE" baseline --dir "$REPO" 2>&1)"
"$GATE" baseline --dir "$REPO" >/dev/null 2>&1
check_code "and exits 1 rather than burying them" 1 "$?"

LEGACY="$WORK/legacy"
mkdir -p "$LEGACY/src"
git -C "$LEGACY" init -q -b main
git -C "$LEGACY" config user.email test@example.com
git -C "$LEGACY" config user.name "Test"
printf '# legacy\n' > "$LEGACY/README.md"
git -C "$LEGACY" add README.md
commit_at "$LEGACY" 200 "add a readme"
cat > "$LEGACY/src/legacy.ts" <<'CODE'
export function old(value: any) {
  if (!value) return null;
  return value;
}
CODE
git -C "$LEGACY" add -A
commit_at "$LEGACY" 100 "add code that predates the gate"
printf 'export const version = 1;
' > "$LEGACY/src/version.ts"
git -C "$LEGACY" add -A
commit_at "$LEGACY" 1 "add a version constant"
check "records what already existed" "recorded 2 accepted" "$("$GATE" baseline --dir "$LEGACY" 2>&1)"
# The middle commit carries the legacy violations.
check "a baselined finding stops blocking" "accepted by the baseline" \
  "$("$GATE" check --range HEAD~2...HEAD~1 --dir "$LEGACY" 2>&1)"
git -C "$LEGACY" stash -q --include-untracked 2>/dev/null
check "an unresolvable range is reported plainly" "does not resolve" \
  "$("$GATE" check --range nope...HEAD --dir "$LEGACY" 2>&1)"

check "--no-baseline sees a baselined finding again" "blocked" \
  "$("$GATE" check --range HEAD~2...HEAD~1 --dir "$LEGACY" --no-baseline 2>&1)"
check "--range is refused for baseline" "does not apply" \
  "$("$GATE" baseline --range main...HEAD --dir "$LEGACY" 2>&1)"

echo "file length on a branch check"
LONG="$WORK/long"
mkdir -p "$LONG/src"
git -C "$LONG" init -q -b main
git -C "$LONG" config user.email test@example.com
git -C "$LONG" config user.name "Test"
printf '# long\n' > "$LONG/README.md"
git -C "$LONG" add -A
git -C "$LONG" commit -q -m "add a readme

The repository needs somewhere to say what it is."
awk 'BEGIN { for (i = 1; i <= 300; i++) printf "export const value%d = %d;\n", i, i }' > "$LONG/src/many.ts"
git -C "$LONG" add -A
git -C "$LONG" commit -q -m "add the constants

They come from the upstream table."
check "a range check measures the file, not only a staged one" "file-length" \
  "$("$GATE" check --range HEAD~1...HEAD --dir "$LONG" 2>&1)"

echo "commit messages from another directory"
printf 'Updated the constants.\n' > "$LONG/.git/COMMIT_EDITMSG"
check "the default message file is read from the repository, not the shell's directory" "subject-period" \
  "$("$GATE" message --dir "$LONG" 2>&1)"

echo "suppression without a reason"
cat > "$LONG/src/sdk.ts" <<'CODE'
export const client: any = sdk(); // gate-ignore: any
CODE
git -C "$LONG" add -A
check "a suppression with no reason is reported" "gives no reason" \
  "$("$GATE" check --staged --dir "$LONG" 2>&1)"

echo "rules"
rules="$("$GATE" rules)"
check "lists a rule with its severity" "secret" "$rules"
check "says why an advisory rule never blocks" "advisory:" "$rules"
"$GATE" rules --dir "$WORK" >/dev/null 2>&1
check_code "works outside a repository" 0 "$?"

echo "next-line suppression"
NEXT="$WORK/next"
mkdir -p "$NEXT/src"
git -C "$NEXT" init -q -b main
git -C "$NEXT" config user.email test@example.com
git -C "$NEXT" config user.name "Test"
cat > "$NEXT/src/sdk.ts" <<'CODE'
// gate-ignore-next-line: any the SDK ships no types
export const client: any = sdk();
CODE
git -C "$NEXT" add -A
check "a directive above the line silences it" "clean" "$("$GATE" check --staged --dir "$NEXT" 2>&1)"

echo "strict"
WARN_REPO="$WORK/warn-repo"
mkdir -p "$WARN_REPO/src"
git -C "$WARN_REPO" init -q -b main
git -C "$WARN_REPO" config user.email test@example.com
git -C "$WARN_REPO" config user.name "Test"
cat > "$WARN_REPO/src/tally.ts" <<'CODE'
export function tally(rows: string[]) {
  console.log(rows.length);
  return rows.length;
}
CODE
git -C "$WARN_REPO" add -A
check "warnings alone pass by default" "passed with" "$("$GATE" check --staged --dir "$WARN_REPO" 2>&1 | tail -1)"
"$GATE" check --staged --dir "$WARN_REPO" >/dev/null 2>&1
check_code "and exit 0" 0 "$?"
"$GATE" check --staged --dir "$WARN_REPO" --strict >/dev/null 2>&1
check_code "--strict blocks on warnings" 1 "$?"

echo "commit messages"
printf 'added retries.\n' > "$WORK/msg-bad"
bad_message="$("$GATE" message "$WORK/msg-bad" --dir "$REPO" 2>&1)"
check "flags the past tense" "imperative" "$bad_message"
check "flags a trailing period" "subject-period" "$bad_message"
check "flags a missing body" "no-body" "$bad_message"
printf 'add a retry to the charge path\n\nThe provider drops one request in a thousand and a dropped charge\nlooked like a decline.\n' > "$WORK/msg-good"
check "accepts a good message" "clean" "$("$GATE" message "$WORK/msg-good" --dir "$REPO" 2>&1)"

echo "pull-request bodies"
printf '## Description\nAdds a retry.\n\n## Motivation\n\n## Testing\nRan the suite.\n' > "$WORK/pr-bad"
bad_pr="$("$GATE" pr --body "$WORK/pr-bad" --dir "$REPO" 2>&1)"
check "flags an empty section" "empty-section" "$bad_pr"
check "flags a missing section" "missing-section" "$bad_pr"
printf '## Description\nRetry a dropped charge once.\n\n## Motivation\nABC-12: dropped charges looked like declines.\n\n## Testing\nUnit tests plus one manual charge against the sandbox. Not covered: the provider timing out twice.\n\n## Rollout\nBehind the retry flag; turn it off to revert.\n' > "$WORK/pr-good"
check "accepts a filled-in body" "clean" "$("$GATE" pr --body "$WORK/pr-good" --dir "$REPO" 2>&1)"
check "asks where the body is" "say where the body is" "$("$GATE" pr --dir "$REPO" 2>&1)"

echo "install"
installed="$("$GATE" install --dir "$REPO" 2>&1)"
check "writes a pre-commit hook" "pre-commit" "$installed"
check "writes a commit-msg hook" "commit-msg" "$installed"
check "writes a Claude Code skill" "SKILL.md" "$installed"
check "the hook is executable" "yes" "$([ -x "$REPO/.git/hooks/pre-commit" ] && echo yes || echo no)"
check "does not overwrite without --force" "skipped" "$("$GATE" install --dir "$REPO" 2>&1)"

echo "errors"
check "a directory outside git is reported" "not inside a git repository" "$("$GATE" check --dir "$WORK" 2>&1)"
"$GATE" check --dir "$WORK" >/dev/null 2>&1
check_code "and exits 3" 3 "$?"
check "an unknown option is refused" "unknown option" "$("$GATE" --nope --dir "$REPO" 2>&1)"
check "an unknown command is refused" "unknown command" "$("$GATE" wat --dir "$REPO" 2>&1)"
check "a missing option value is refused" "needs a value" "$("$GATE" check --dir "$REPO" --range 2>&1)"
check "help lists the commands" "baseline" "$("$GATE" --help)"
check "version prints a number" "1." "$("$GATE" --version)"

echo
printf "passed: %s   failed: %s\n" "$pass" "$fail"
[ "$fail" -eq 0 ]
