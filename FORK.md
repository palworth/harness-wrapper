# harness-wrapper

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), renamed and kept
current with upstream releases.

- Upstream: <https://github.com/pingdotgg/t3code>
- Fork: <https://github.com/palworth/harness-wrapper>
- Local checkout: `~/dev/t3code` (`origin` = fork, `upstream` = pingdotgg/t3code)

## Auto-sync

`.github/workflows/sync-upstream.yml` runs every 6 hours (and on manual dispatch) and:

1. Resolves the latest **release tag** on `pingdotgg/t3code` (`gh release view`).
2. Skips it if that tag is already an ancestor of `main`.
3. Merges it into a `sync/<tag>` branch and opens a PR.
4. Runs the gate job on that branch: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`.
5. Waits for every check on the PR, then **merges it automatically when green**.
6. If the merge conflicts, it opens an issue titled `Upstream sync conflict: <tag>` instead and stops.

Trigger it manually from the Actions tab → _Sync upstream release_ → _Run workflow_ (optionally pass a
specific `tag`). Sync PRs are labeled `upstream-sync`.

Sync policy choices:

- **Release tags only** — never `upstream/main`, so every sync is a tested snapshot.
- **Merge commits, never squash** — keeps the upstream history intact for later merges.

## What this fork changes

Keep this list short. Every file touched here is a potential conflict on each release sync, so prefer
additive files (new components, new scripts, a new workflow) over editing upstream files.

### Branding (light rebrand)

Renamed from _T3 Code_ to _harness-wrapper_ in user-visible strings only. Bundle IDs
(`com.t3tools.t3code`), the `t3code://` protocol, the `t3` CLI, and data directories are untouched so
upstream behavior and update channels keep working.

| File                                         | Change                                       |
| -------------------------------------------- | -------------------------------------------- |
| `apps/desktop/src/app/DesktopEnvironment.ts` | `APP_BASE_NAME` → `harness-wrapper`          |
| `apps/web/src/branding.ts`                   | fallback `APP_BASE_NAME` → `harness-wrapper` |
| `apps/desktop/package.json`                  | `productName` → `harness-wrapper (Alpha)`    |
| `apps/desktop/scripts/electron-launcher.mjs` | dev/prod display names                       |
| `apps/web/index.html`                        | document `<title>`                           |
| `scripts/install.sh`, `scripts/install.ps1`  | "Installed …" banner                         |

Tests that assert the old name were updated alongside: `apps/web/src/branding.test.ts`,
`apps/desktop/src/app/DesktopAppIdentity.test.ts`, `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`,
`scripts/build-desktop-artifact.test.ts`, `scripts/install.test.ts`.

## Adding features

Work on a branch off `main`, not on `main` itself:

```bash
cd ~/dev/t3code
git checkout -b feat/my-feature
# ... commit ...
gh pr create --title "feat: my feature"   # upstream CI runs on PRs
```

Guidelines that keep release syncs painless:

1. **Additive over invasive** — new files and new exports merge cleanly; edits inside upstream modules
   conflict when upstream refactors them.
2. **Keep the rebrand list short** — if a new feature needs the app name, import `APP_BASE_NAME` /
   `APP_DISPLAY_NAME` instead of hardcoding strings.
3. **Never edit release/CI config** (`.github/workflows/ci.yml`, `release*.yml`) unless you intend to
   own that divergence.
4. Rebase on `main` after each auto-sync so your branch starts from current upstream code.

## Repo settings

- `allow_auto_merge` is enabled (required for the sync PR to merge itself).
- Issues are enabled (used for conflict reports).
- Actions are enabled for the fork.
