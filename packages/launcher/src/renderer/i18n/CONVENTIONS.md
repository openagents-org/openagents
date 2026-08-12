# i18n conventions (react-i18next)

The launcher uses **react-i18next**. Setup lives in `src/renderer/i18n/index.ts`.
Locale resources are split per feature: every file `locales/<lng>/<ns>.json` is
merged (via Vite glob) into that language's `translation` namespace under the
top-level key `<ns>` (the filename). So `locales/en/agents.json` containing
`{ "title": "Agents" }` is referenced in code as `t("agents.title")`.

Supported languages: `en` (source wording, copy English verbatim) and `zh`
(Simplified Chinese — natural, fluent, not literal/machine-style).

## How to internationalize a component

1. `import { useTranslation } from "react-i18next"`.
2. Inside **every** React component function in the file (including small
   sub-components defined lower in the same file), add `const { t } = useTranslation()`.
3. Replace user-facing English string **literals** with `t("<ns>.<key>")`:
   - JSX text content
   - `title`, `placeholder`, `aria-label`, `alt` attribute strings
   - toast / dialog / button / label / empty-state / error-message text
4. Interpolation for dynamic values: `t("ns.key", { name })` with `{{name}}` in
   the JSON. Example: `"greeting": "Hi {{name}}"`.
5. Pluralization: pass `{ count }` and provide `key` / `key_other` if needed;
   for simple cases `"unread": "{{count}} unread"` is fine.
6. Module-level constant arrays that hold labels (e.g. `const TABS = [...]`):
   keep only ids/icons at module level and translate with `t()` at render time
   (see how `Sidebar.tsx` NAV_ITEMS / `settings/index.tsx` SECTIONS were done).

## Do NOT translate / change

- Code identifiers, `className` strings, `data-*` values, CSS, URLs
- `console.log` / `console.error` / thrown `Error(...)` developer messages
- Agent type ids, model ids, env var names, analytics event names, JSON keys
- Behavior/logic — only externalize strings.

## Product name

The app is **OpenAgents Launcher** / **OpenAgents 启动器**; plain **OpenAgents**
is the platform behind it (the org, the site, the hosted services). Never type
either name into a locale string — pull it in with i18next nesting so both
languages stay in step and a rename touches one line:

- `$t(common.appName)` — the thing the user is running (restart, start at login,
  appearance, About).
- `$t(common.brandName)` — the platform (hosted workspaces, "never uploaded to
  …", the `openagents` skin, copyright).

Nesting needs no `t()` options: `"restartGroupDesc": "… $t(common.appName) …"`.
The main process has no i18next, so `src/main/i18n.ts` spells the full name out
inline per language — keep it identical to `common.appName` there.

## Locale file rules

- Create ONLY your own `locales/en/<ns>.json` and `locales/zh/<ns>.json`.
- Do NOT edit `common.json`, `nav.json`, `settings.json`, or `index.ts`.
- You MAY reuse existing shared keys read-only when a string matches exactly:
  `common.loading` ("Loading…"), `common.cancel`, `common.reset`,
  `common.import`, `common.export`, `common.download`, `common.documentation`,
  `common.none`, `common.notInstalled`, `common.checking`.
- Keep keys nested and descriptive; en and zh files must have identical key shape.

## Verify before finishing

From `packages/launcher`, run `npx tsc -p tsconfig.web.json --noEmit`.
Your touched files must have no NEW type errors. Ignore the single PRE-EXISTING
error in `src/renderer/utils/installErrors.ts` — it is unrelated.
