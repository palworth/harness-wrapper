#!/usr/bin/env bash
# Re-applies the OC-UI brand to upstream's "T3 Code" copy.
#
# Upstream writes new user-facing copy constantly, so after every release sync
# (or whenever a conflict touches copy), keep upstream's text and re-run this:
#
#   git checkout --theirs -- .      # take upstream's wording for conflicted files
#   ./scripts/rebrand.sh            # rename the brand again
#   git add -A && git commit
#
# Recorded test data (replay transcripts, *.fixture.* files, mock providers) IS
# rewritten: those recordings assert what this app sends, so they have to carry
# this app's name or every provider replay test fails on the first frame.
#
# Deliberately NOT rewritten:
#   - DesktopUserData / DesktopLegacyLocalStorage / DesktopPreReadyFileSystem,
#     whose "T3 Code (Alpha)" literals are the on-disk profile names of old
#     installs — renaming them would stop existing installs from migrating.
#   - server evaluation fixtures (threadTitleEvaluationCases) and anything
#     carrying a trailing "brand-keep" marker.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TO="OC-UI"
# The earlier fork name, rewritten to $TO too, except in the repo URL
# (github.com/palworth/harness-wrapper).
PREVIOUS="harness-wrapper"
# The old name in any casing ("T3 Code", "T3 CODE", "t3 code") and in its
# form-encoded spelling ("T3+Code", which hides inside URL-encoded bodies).
FROM_CI="t3 code"
ENCODED_CI="t3+code"

SCOPE=(
  apps/web/src
  apps/desktop/src
  apps/desktop/scripts
  apps/desktop/gnome-extension
  apps/server/src
  apps/mobile/src
  packages
)
EXTRA=(
  apps/web/index.html
  # The triage prompt must stay byte-identical to this playbook or
  # src/cli/triagePrompt.test.ts fails.
  .github/triage/PLAYBOOK.md
  # Mock provider whose responses AcpAdapterV2.test.ts asserts on.
  apps/server/scripts/acp-mock-agent.ts
)

is_excluded() {
  case "$1" in
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
  # Lines carrying a "brand-keep" marker name old installs on disk or what the
  # outside world really emits, and must keep upstream's spelling forever.
  perl -pi -e "s/\b\Q$FROM_CI\E\b/$TO/gi unless /brand-keep/; s/\b\Q$ENCODED_CI\E\b/$TO/gi unless /brand-keep/; s{(?<!palworth/)\Q$PREVIOUS\E\b}{$TO}gi unless /brand-keep/" "$file"
  changed=$((changed + 1))
done < <(grep -rIli -e "$FROM_CI" -e "$ENCODED_CI" -e "$PREVIOUS" "${SCOPE[@]}" "${EXTRA[@]}" --exclude-dir=node_modules 2>/dev/null || true)

echo "Rebranded $changed file(s): T3 Code -> $TO"
