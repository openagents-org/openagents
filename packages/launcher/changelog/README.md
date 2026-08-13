# Release notes

One JSON file per launcher version, named after the version: `0.9.9.json`.

Everything the user reads in the launcher's **What's new** dialog comes from
here — the dialog that opens once after an update, and the "Release notes"
entry in Settings → Updates.

## Why one file per version

This is a monorepo. The GitHub Release body is generated from every PR that
landed since the last tag, so it is mostly frontend/workspace/adapter work that
has nothing to do with the desktop app — it cannot be shown to launcher users.
And a single shared `CHANGELOG.md` would conflict in every parallel PR. One
small file per version avoids both.

## Format

```json
{
  "version": "0.9.9",
  "date": "2026-08-13",
  "entries": [
    {
      "type": "feature",
      "title": {
        "en": "Join a workspace with a pairing code",
        "zh": "用配对码加入工作区"
      },
      "description": {
        "en": "Copy the eight-character code from Connect Agent → Nodes and paste it in — no token, no link, no config file.",
        "zh": "在「Connect Agent → Nodes」复制 8 位配对码粘贴进来即可，不需要令牌、链接或配置文件。"
      }
    }
  ]
}
```

- `version` — must equal the `version` field in `package.json` and the file name.
- `date` — `YYYY-MM-DD`, the release date.
- `entries[].type` — `feature`, `improvement` or `fix`. Anything else is
  rendered as `improvement`.
- `entries[].title` — the change in a few words. This is what someone scanning
  the list reads, so it has to stand on its own.
- `entries[].description` — optional detail under the title. Leave it out when
  the title already says everything.
- Every `en` needs its `zh` and vice versa. Write for the person using the app,
  not for the person who wrote the patch: "Agents you install now keep their
  working directory" beats "fix(agents): persist cwd in registry".

There is no per-release headline. The line under the dialog's title is fixed
copy that explains what the dialog is (`whatsNew.subtitle` in the locale
files) — it describes the feature, not the release, so it must not change from
version to version.

## Rules

- Add the file in the same PR as the change, or the release will ship with a
  half-written announcement.
- CI fails a `launcher-v*` tag whose version has no matching file here, and
  fails on a malformed one — see `scripts/check-changelog.mjs`, run by
  `npm run check:changelog`.
- Files are bundled into the app at build time, so the notes are available
  offline and always match the version the user is actually running.
- Never edit a released version's file to describe a *later* release. Users who
  already saw it will not see it again.
- One exception, and it is about that last clause: notes that provably reached
  **nobody** may be merged forward into the next version's file and the old one
  deleted. That is where 0.9.9's went — the dialog meant to show them never
  opened, because it mistook every update for a first install, so merging them
  into `0.9.10.json` was the only way their contents ever reached a user. If
  even one person could have read them, they stay where they are.
