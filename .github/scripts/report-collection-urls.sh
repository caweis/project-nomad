#!/usr/bin/env bash
set -euo pipefail

# A feature-branch result cannot open or close the main branch's tracking issue.
[[ "${GITHUB_REF:-}" == refs/heads/main ]] || exit 0
case "${GITHUB_EVENT_NAME:-}" in schedule|workflow_dispatch) ;; *) exit 0 ;; esac
outcome="${1:?Expected success or failure}"
case "$outcome" in success|failure) ;; *) echo "Unsupported catalog outcome: $outcome" >&2; exit 1 ;; esac

title='Catalog URLs failing on main'
number="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open \
  --search "in:title \"$title\"" --json number,title \
  --jq "[.[] | select(.title == \"$title\")][0].number // empty")"

if [[ "$outcome" == success ]]; then
  if [[ -n "$number" ]]; then
    gh issue close "$number" --repo "$GITHUB_REPOSITORY" \
      --comment "All catalog URLs passed in ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}."
  fi
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
{
  printf 'The catalog URL check failed on `main`.\n\n'
  # The validator's output is data, never shell input. Bound the number of reported URLs.
  if [[ -f "${2:-}" ]] && grep -q '^FAILED:' "$2"; then
    awk '/^FAILED:/ { print; count++; if (count == 100) exit }' "$2"
  else
    printf 'No failed URL lines were captured; see the run log.\n'
  fi
  printf '\nRun: %s/%s/actions/runs/%s\n' "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID"
} > "$tmp/body.md"
if [[ -n "$number" ]]; then
  gh issue comment "$number" --repo "$GITHUB_REPOSITORY" --body-file "$tmp/body.md"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$tmp/body.md"
fi
