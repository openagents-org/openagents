# App Store / Google Play assets

Store-listing images for the OpenAgents mobile apps, plus the pipeline that
generates them from the real product. iPhone-only on iOS by decision
(2026-08-24) — no iPad set is shipped; if that changes, re-add the
`ios-ipad` target in `scripts/compose-store.js`.

## Contents

- `out/ios-iphone/` — 12 screenshots, 1320×2868 (6.9" class), 6 scenes × EN/中文
- `out/play-phone/` — 12 screenshots, 1080×1920, same scenes
- `out/play-graphics/` — feature graphic 1024×500 (EN/中文, no alpha) and
  512×512 Play icon (32-bit PNG)
- `scripts/` — the full pipeline (see below)

All screenshots are the real Workspace UI, captured from seeded demo
workspaces — no mockups, no customer data.

## Pipeline

1. `scripts/seed-store-ws.py` — creates demo workspaces via the
   workspace-endpoint API and seeds threads/routines/knowledge/todos per
   scene. Saves credentials to `~/store-assets/case-ws.json`.
   NOTE: channels are seeded with an empty participant list — as of
   2026-08-20 posting into a channel created with ≥2 participants hangs the
   `/v1/events` request (backend regression, reproducible with curl).
2. `scripts/capture-raw.js` — playwright-core + the headless-shell rig;
   captures phone (390×844@3x) and tablet (1024×840@2x) scenes, scrolled to
   the start of each conversation, with system banners/pills scrubbed.
3. `scripts/compose-store.js` — renders each capture into a branded store
   frame (caption EN/中文 + device bezel) at exact store pixel sizes, then
   assets are flattened to RGB and dimension-checked before packaging.

Requires: the Playwright chromium headless shell (with extracted system libs
— see the script headers), Noto Sans CJK + Noto Color Emoji fonts installed
under `~/.local/share/fonts` for 中文 captions and emoji in message content.
