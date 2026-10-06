# OC-UI

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), branded **OC-UI** and kept
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

Renamed from _T3 Code_ to _OC-UI_ in user-visible strings only (the repo itself is still
`palworth/harness-wrapper`, the fork's first name). Bundle IDs
(`com.t3tools.t3code`), the `t3code://` protocol, the `t3` CLI, and data directories are untouched so
upstream behavior and update channels keep working.

| File                                         | Change                             |
| -------------------------------------------- | ---------------------------------- |
| `apps/desktop/src/app/DesktopEnvironment.ts` | `APP_BASE_NAME` → `OC-UI`          |
| `apps/web/src/branding.ts`                   | fallback `APP_BASE_NAME` → `OC-UI` |
| `apps/desktop/package.json`                  | `productName` → `OC-UI (Alpha)`    |
| `apps/desktop/scripts/electron-launcher.mjs` | dev/prod display names             |
| `apps/web/index.html`                        | document `<title>`                 |
| `scripts/install.sh`, `scripts/install.ps1`  | "Installed …" banner               |

Tests that assert the old name were updated alongside: `apps/web/src/branding.test.ts`,
`apps/desktop/src/app/DesktopAppIdentity.test.ts`, `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`,
`scripts/build-desktop-artifact.test.ts`, `scripts/install.test.ts`.

### In-app copy sweep

`scripts/rebrand.sh` rewrites upstream's "T3 Code" wording to "OC-UI" (and the earlier fork name "harness-wrapper") across app source
(`apps/web/src`, `apps/desktop/src`, `apps/desktop/scripts`, `apps/desktop/gnome-extension`,
`apps/server/src`, `apps/mobile/src`, `packages`, plus `apps/web/index.html` and two files outside the
scope — see below). It is idempotent and safe to re-run — that is the point: upstream writes new copy
constantly, so after a release sync takes upstream's wording, run it again:

```bash
./scripts/rebrand.sh
git add -A && git commit -m "chore: re-apply OC-UI copy"
```

What it does **not** rewrite:

| Where                                                                             | Why                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DesktopUserData`, `DesktopLegacyLocalStorage`, `DesktopPreReadyFileSystem` tests | `T3 Code (Alpha)` is the on-disk profile folder of old installs — renaming it stops the migration                         |
| any line carrying a `brand-keep` comment                                          | fixture values that describe the outside world (e.g. the `"T3 Code delegate_task"` tool name upstream agents really emit) |
| `apps/server/scripts/threadTitleEvaluationCases.ts`                               | model-title evaluation data, not UI copy                                                                                  |

Recorded test data **is** rewritten — replay transcripts (`testkit/fixtures/**`, `*.ndjson`), `*.fixture.*`
files, and `apps/server/scripts/acp-mock-agent.ts`. Those recordings assert the exact frames this app
sends to providers and mock servers, so with upstream's name they fail on the very first
`initialize` frame (`CodexAppServerReplayFrameMismatchError`), and the failure cascades into
everything downstream (fork, merge-back, replay recovery, title generation).

New exclusions belong in `scripts/rebrand.sh`, not in a one-off manual edit.

Never swept (by design, not oversight):

| Where                                                     | Why                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/**`, `README.md`, `AGENTS.md`, most of `.github/**` | upstream's documentation; rewording it only creates conflicts (`.github/triage/PLAYBOOK.md` is the one exception — a test requires it byte-identical to the triage prompt) |
| `apps/marketing/**`                                       | the hosted marketing site is upstream's — a separate, high-conflict rebrand if you want it                                                                                 |
| `apps/mobile/app.config.ts`                               | the mobile app's actual name (`appName`) and store metadata — deep rebrand territory                                                                                       |
| `native/**`, `packaging/**`, `patches/**`                 | build/packaging metadata and native helper sources                                                                                                                         |
| macOS DMG background SVGs, app icons                      | artwork; needs a designer, not a sed                                                                                                                                       |

Matching is case-insensitive over the phrase (`T3 Code`, `T3 CODE`, `t3 code`) and also covers the
form-encoded spelling (`T3+Code`), which hides inside URL-encoded request bodies — both otherwise
produce assertions that pass on the plain-text pass and fail in CI.

To rename the app again, change `TO` in `scripts/rebrand.sh`, move the old name into `PREVIOUS`, run it,
and update the handful of files outside its scope by hand (`scripts/install.*`,
`scripts/build-desktop-artifact.test.ts`, `apps/desktop/package.json`).

### Typography

`apps/web/src/fork/brand.css` (imported once from `apps/web/src/main.tsx`) sets the default interface
font to **IBM Plex Sans** and code to **IBM Plex Mono**: an engineered, Palantir-style pairing. The
fonts are vendored in `apps/web/src/fork/fonts/` (SIL OFL) so the desktop app needs no network. A
family chosen in Settings → Appearance still overrides it. To try another face, swap the files and
the `--font-sans` / `--font-mono` values in that one CSS file.

The sidebar header shows `APP_BASE_NAME` as a mono, uppercase, wide-tracked text mark instead of
upstream's T3 wordmark (`SidebarBrandMark` in `apps/web/src/components/sidebar/SidebarChrome.tsx`). The
small T3 glyph used as an icon in the timeline and welcome wizard, and the app icons, are still
upstream's artwork.

### Voice dictation

A mic button sits left of the composer's paperclip (`apps/web/src/fork/VoiceDictationButton.tsx`,
wired in with a few lines in `components/chat/ChatComposer.tsx`). Click to talk, click again to stop;
text is typed at the caret while you speak.

- Streams 24 kHz PCM16 to OpenAI's Realtime API (`wss://api.openai.com/v1/realtime?intent=transcription`)
  with the `gpt-live-transcribe` model and inserts each `…transcription.delta` as it arrives
  (`apps/web/src/fork/voiceDictation.ts`). Stopping sends `input_audio_buffer.commit` and waits up to
  5 s for the final transcript.
- **API key:** in dev (`import.meta.env.DEV`) read from `VITE_OPENAI_API_KEY` in `apps/web/.env.local`
  (gitignored by `.env*`); production builds ignore it, so the key is never bundled. A key
  entered in the app (right-click the mic) is stored in localStorage under `oc-ui:openai-api-key` and
  takes precedence (and is the only source in production builds).
- Override the model with `localStorage.setItem("oc-ui:transcription-model", "gpt-transcribe")`.
- macOS: `NSMicrophoneUsageDescription` is added in `scripts/build-desktop-artifact.ts` so packaged
  builds can ask for the mic.

### CI runners

`.github/workflows/ci.yml` targets `blacksmith-*` runners, which only work when the Blacksmith GitHub
App is installed on the account. On this fork they are mapped to GitHub-hosted runners, which are
**free and unlimited for public repositories**:

| Upstream                             | Here                    |
| ------------------------------------ | ----------------------- |
| `blacksmith-{2,4,8}vcpu-ubuntu-2404` | `ubuntu-24.04` (4 vCPU) |
| `blacksmith-6vcpu-macos-26`          | `macos-latest`          |

If upstream adds a job with a `blacksmith-*` runner label, it queues forever until you map it the same
way. `.github/actions/setup-apt-mirrors` writes its own mirror-list file, so it keeps working on
GitHub-hosted runners.

## Known failures that are not the fork's fault

- `scripts/build-desktop-artifact.test.ts > skips the primary native probe for cross-architecture
Windows payloads` — fails on macOS locally, passes on Linux CI. Pre-dates every fork commit.
- `apps/mobile/src/features/review/shikiReviewHighlighter.test.ts > initializes source and snippet
highlighting without a warmup` — token-granularity race between two highlight paths; fails
  occasionally in CI, passes when run locally. Re-run before blaming a change.
- Local `pnpm test` never reaches `apps/server`: `vp run -r test` stops at the first failing workspace
  (usually the local-only `build-desktop-artifact` failure above), so server regressions only show up
  in CI. Run them explicitly: `cd apps/server && corepack pnpm vp test run`.

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
- Upstream workflows for infrastructure are **disabled** (state persists across release syncs):
  `release` (which runs on a 30-minute schedule), `release-desktop`, `deploy-relay`,
  `cursor-hygiene-webhook`, `web-preview`, `thread-transfer-report`, `mobile-eas-*`,
  `mobile-fingerprint-check`, `mobile-showcase-screenshots`, `desktop-macos-preview*`, `publish-aur`,
  `pr-vouch`, `pr-size`, `issue-labels`.
  **Kept enabled:** `CI`, `Sync upstream release` (and `windows-tests`, manual dispatch only).
  Re-enable with `gh workflow enable <file> --repo palworth/harness-wrapper`.
