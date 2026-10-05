#!/usr/bin/env bash
# Re-applies the harness-wrapper brand to upstream's "T3 Code" copy.
#
# Upstream writes new user-facing copy constantly, so after every release sync
# (or whenever a conflict touches copy), keep upstream's text and re-run this:
#
#   git checkout --theirs -- .      # take upstream's wording for conflicted files
#   ./scripts/rebrand.sh            # rename the brand again
#   git add -A && git commit
#
# Deliberately NOT rewritten:
#   - recorded provider transcripts and *.fixture.* files (test data)
#   - DesktopUserData / DesktopLegacyLocalStorage / DesktopPreReadyFileSystem,
#     whose "T3 Code (Alpha)" literals are the on-disk profile names of old
#     installs — renaming them would stop existing installs from migrating.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FROM="T3 Code"
ENCODED="T3+Code" # application/x-www-form-urlencoded spelling of the same phrase
TO="harness-wrapper"

SCOPE=(
  apps/web/src
  apps/desktop/src
  apps/server/src
  apps/mobile/src
  packages
)
EXTRA=(apps/web/index.html)

is_excluded() {
  case "$1" in
    */fixtures/* | *.ndjson | *.fixture.* | \
    apps/desktop/src/app/DesktopUserData.ts | \
    apps/desktop/src/app/DesktopUserData.test.ts | \
    apps/desktop/src/app/DesktopLegacyLocalStorage.ts | \
    apps/desktop/src/app/DesktopPreReadyFileSystem.test.ts)
      return 0
      ;;
  esac
  return 1
}

changed=0
while IFS= read -r file; do
  if is_excluded "$file"; then continue; fi
  # "T3 Code" plus its form-encoded spelling ("T3+Code"), which shows up in
  # URL-encoded request bodies and would otherwise slip through unnoticed.
  if grep -qF "$FROM" "$file" || grep -qF "$ENCODED" "$file"; then
    # Lines carrying a "brand-keep" marker name old installs on disk and must
    # keep upstream's spelling no matter how often this runs.
    perl -pi -e "s/\Q$FROM\E/$TO/g unless /brand-keep/; s/\Q$ENCODED\E/$TO/g unless /brand-keep/" "$file"
    changed=$((changed + 1))
  fi
done < <(grep -rIl -e "$FROM" -e "$ENCODED" "${SCOPE[@]}" "${EXTRA[@]}" --exclude-dir=node_modules 2>/dev/null || true)

echo "Rebranded $changed file(s): $FROM -> $TO"
