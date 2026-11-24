#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_CALLS"
case "$1 $2" in
  'issue list')
    [[ "${FAIL_LIST:-0}" == 0 ]] || exit 17
    printf '%s\n' "${ISSUE_NUMBER:-}"
    ;;
  'issue create'|'issue comment')
    while (( $# )); do
      if [[ "$1" == --body-file ]]; then cp "$2" "$GH_BODY"; break; fi
      shift
    done
    ;;
  'issue close') ;;
  *) exit 99 ;;
esac
STUB
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" GH_CALLS="$tmp/calls" GH_BODY="$tmp/body"
export GITHUB_REPOSITORY=caweis/project-nomad GITHUB_SERVER_URL=https://github.com GITHUB_RUN_ID=123
export GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=schedule
printf 'OK: https://example.test/good\nFAILED: https://example.test/bad (HTTP 404)\n' > "$tmp/check.log"
run() { bash "$script_dir/report-collection-urls.sh" "$@"; }
reject_match() {
  if grep -q "$1" "$2"; then
    printf 'Unexpected match: %s in %s\n' "$1" "$2" >&2
    exit 1
  else
    result=$?
    if [[ "$result" != 1 ]]; then
      printf 'Could not check %s (grep exit %s)\n' "$2" "$result" >&2
      exit "$result"
    fi
  fi
}

# PRs, pushes and manually selected feature branches cannot mutate main's issue.
for event in pull_request push; do
  GITHUB_EVENT_NAME="$event" run failure "$tmp/check.log"
done
GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/heads/fix run success "$tmp/check.log"
[[ ! -e "$GH_CALLS" ]]

run failure "$tmp/check.log"
grep -q 'issue create' "$GH_CALLS"
grep -q 'https://example.test/bad' "$GH_BODY"
reject_match 'https://example.test/good' "$GH_BODY"
grep -q '/actions/runs/123' "$GH_BODY"

: > "$GH_CALLS"
ISSUE_NUMBER=41 GITHUB_EVENT_NAME=workflow_dispatch run failure "$tmp/missing.log"
grep -q 'issue comment 41' "$GH_CALLS"
grep -q 'No failed URL lines were captured' "$GH_BODY"
reject_match 'issue create' "$GH_CALLS"

: > "$GH_CALLS"
ISSUE_NUMBER=41 run success "$tmp/check.log"
grep -q 'issue close 41' "$GH_CALLS"
: > "$GH_CALLS"
run success "$tmp/check.log"
reject_match 'issue close' "$GH_CALLS"

: > "$GH_CALLS"
if FAIL_LIST=1 run failure "$tmp/check.log"; then
  echo 'A failed issue lookup must fail reporting' >&2; exit 1
fi
reject_match 'issue create' "$GH_CALLS"
if run cancelled "$tmp/check.log"; then
  echo 'Unsupported outcomes must not close the issue' >&2; exit 1
fi
printf 'Collection URL reporting checks passed (9 scenarios)\n'
