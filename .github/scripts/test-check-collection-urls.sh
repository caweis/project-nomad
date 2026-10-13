#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/good" "$tmp/bad" "$tmp/empty" "$tmp/invalid"

cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
method=GET
has_range=0
has_size_cap=0
for arg in "$@"; do
  [[ "$arg" == --head ]] && method=HEAD
  [[ "$arg" == --range ]] && has_range=1
  [[ "$arg" == --max-filesize ]] && has_size_cap=1
done
url="${@: -1}"
printf '%s %s\n' "$method" "$url" >> "$CURL_CALLS"
case "$url" in
  https://example.test/ok) printf '200' ;;
  https://example.test/fallback)
    if [[ "$method" == HEAD ]]; then
      printf '405'
    elif (( has_range == 1 && has_size_cap == 1 )); then
      printf '206'
    else
      exit 98
    fi
    ;;
  https://example.test/missing) printf '404' ;;
  https://example.test/failed-transfer) printf '200'; exit 18 ;;
  *) exit 99 ;;
esac
SH
chmod +x "$tmp/bin/curl"
export CURL_CALLS="$tmp/curl-calls"
export PATH="$tmp/bin:$PATH"

cat > "$tmp/good/collection.json" <<'JSON'
{"resources":[{"url":"https://example.test/ok"},{"url":"https://example.test/fallback"},{"url":"https://example.test/ok"},{"url":null}]}
JSON
bash "$script_dir/check-collection-urls.sh" "$tmp/good" > "$tmp/good-output"
grep -q 'Checked 2 URLs; 0 failed.' "$tmp/good-output"
grep -q 'HEAD https://example.test/fallback' "$CURL_CALLS"
grep -q 'GET https://example.test/fallback' "$CURL_CALLS"
[[ "$(wc -l < "$CURL_CALLS" | tr -d ' ')" == 3 ]]

cat > "$tmp/bad/collection.json" <<'JSON'
{"resources":[{"url":"https://example.test/missing"},{"url":"https://example.test/failed-transfer"},{"url":"file:///etc/passwd"}]}
JSON
if bash "$script_dir/check-collection-urls.sh" "$tmp/bad" > "$tmp/bad-output"; then
  echo 'Expected broken URLs to fail validation' >&2
  exit 1
fi
grep -q 'Checked 3 URLs; 3 failed.' "$tmp/bad-output"
grep -q 'HTTP 200 via HEAD, curl exit 18' "$tmp/bad-output"
grep -q 'unsupported URL scheme' "$tmp/bad-output"
if grep -q 'file:///etc/passwd' "$CURL_CALLS"; then
  echo 'An unsupported URL reached curl' >&2
  exit 1
fi

if bash "$script_dir/check-collection-urls.sh" "$tmp/empty" > /dev/null 2>&1; then
  echo 'Expected an empty catalog directory to fail validation' >&2
  exit 1
fi
echo '{' > "$tmp/invalid/collection.json"
if bash "$script_dir/check-collection-urls.sh" "$tmp/invalid" > /dev/null 2>&1; then
  echo 'Expected malformed JSON to fail validation' >&2
  exit 1
fi

echo 'Collection URL validator checks passed'
