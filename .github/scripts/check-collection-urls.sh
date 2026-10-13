#!/usr/bin/env bash
set -euo pipefail

catalog_dir="${1:-collections}"
shopt -s nullglob
catalogs=("$catalog_dir"/*.json)
if (( ${#catalogs[@]} == 0 )); then
  echo "No collection JSON files found in $catalog_dir" >&2
  exit 1
fi

urls="$(jq -r '.. | .url? | select(type == "string")' "${catalogs[@]}" | sort -u)"
if [[ -z "$urls" ]]; then
  echo "No collection URLs found in $catalog_dir" >&2
  exit 1
fi

checked=0
failed=0
while IFS= read -r url; do
  [[ -z "$url" ]] && continue
  checked=$((checked + 1))

  case "$url" in
    http://*|https://*) ;;
    *)
      echo "FAILED: $url (unsupported URL scheme)"
      failed=$((failed + 1))
      continue
      ;;
  esac

  method=HEAD
  curl_exit=0
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --head --location --proto '=http,https' --proto-redir '=http,https' \
    --max-time 30 --retry 2 --retry-delay 2 "$url")" || curl_exit=$?

  case "$status" in
    403|405|501)
      method=GET
      curl_exit=0
      status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --range 0-0 --max-filesize 8192 --location \
        --proto '=http,https' --proto-redir '=http,https' \
        --max-time 30 --retry 2 --retry-delay 2 "$url")" || curl_exit=$?
      ;;
  esac

  if (( curl_exit == 0 )) && [[ "$status" == 200 || "$status" == 206 ]]; then
    echo "OK: $url ($status via $method)"
  else
    echo "FAILED: $url (HTTP $status via $method, curl exit $curl_exit)"
    failed=$((failed + 1))
  fi
done <<< "$urls"

echo "Checked $checked URLs; $failed failed."
(( failed == 0 ))
