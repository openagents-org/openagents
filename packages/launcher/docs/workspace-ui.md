# Workspace UI in the desktop app

The launcher ships the web Workspace interface from `workspace/frontend`.
Change workspace lists, creation, chat, files, and settings in those shared
pages and components. Do not add a second Workspace UI to the launcher.

`workspace/frontend/desktop/app.tsx` composes the same pages with a lightweight
hash router and aliases for Next.js client APIs. `build:desktop` bundles that
entry for Electron. The launcher serves the bundle through
`openagents://workspace` in an owned `WebContentsView`. API data still requires
the configured workspace service.

The window has two halves, switched from the mode bar in a fixed place:
Workspace and This Computer. The launcher owns the mode bar, the This Computer
tools, and the signed-out Workspace — Welcome and native sign-in. Signing in
opens the shared membership home. Local agent setup works without an account.
Welcome also links straight to joining a workspace with a pairing code, for a
server or remote machine that needs no account. Opening a connected
workspace from This Computer stays in the app when signed in to the same
deployment, with the device's token; the browser remains a menu option. Joining a workspace as a person does not
authorize the computer: the optional connection action in the shared Devices
settings uses the existing pairing workflow and requires workspace admin access.

First-run onboarding detects the desktop host and offers **Connect this computer**.
The card shows the local hostname and explains the permission before the user
clicks. Main reuses an existing registration or creates and redeems a pairing
code through the account service. The shared UI waits for that exact node to
report online, then opens the existing agent gallery with its node id selected.
Other workspace devices cannot accidentally become the setup target. The
**Connect remote device** option and browser onboarding retain the download
and pairing-code instructions. No connection happens just by opening onboarding.
Desktop agent setup shows connected devices directly, without the cloud-agent
or manual-connection tabs and onboarding links. The shared web flow retains them.

`e2e/workspace-onboarding.spec.ts` exercises these flows against the compiled
Workspace bundle with a simulated host and API, without registering devices or
installing agents. Run it from `packages/launcher` after `npm run build`:
`npx playwright test e2e/workspace-onboarding.spec.ts` (requires Playwright Chromium).

Both Welcome and the email sign-in form open native email registration. It uses
the existing `POST /v1/auth/register` account endpoint, followed by the same
Workspace handoff and session redemption as sign-in. The fields and password
policy match [the account website](https://openagents.org/signup) (verified
September 13, 2026). Registration never falls back to creating a Firebase user.
If registration succeeds but session redemption fails, the form offers sign-in
and explains that the account already exists.

New profiles start in light mode, shared by the native window and Workspace.
The appearance setting still supports dark mode and following the system.
Existing stored choices take precedence over the default.

The welcome illustration is a screenshot of the shared Workspace components
with synthetic content, in both languages and themes. Regenerate it after
Workspace design changes by running `node scripts/render-workspace-preview.mjs`
from `packages/launcher` after building the desktop bundle. The renderer uses
an isolated browser and blocks external requests; the data fixture lives beside
the script. No separate Workspace layout is maintained for the illustration.

`lib/desktop-host.ts` is the shared UI's optional bridge for sign-in, sign-out,
opening This Computer, and connecting the computer. It returns null on the web.
The desktop preload supplies the account session, endpoint, and appearance;
main validates callers before accepting device connection requests. Appearance
sync remains in `desktop/host.ts`.

Main is the only owner of the account session. The preload plants it when the
page loads and forwards renewals through `onSession`; the page never reports its
own storage back, so nothing it does to that storage can sign the app out.
Signing in and out from the page are requests to main. However an account ends —
sign-out on either side, expiry, a refused renewal — main destroys the view and
clears its storage, and waits for that before creating another view.

The view is drawn above the launcher's DOM. Launcher toasts raised while it is on
screen are repeated inside it through `onNotice`, and the update banner sits in
the mode bar instead of floating over the content area.

Switching to This Computer hides the web view while keeping its live state.
On relaunch, the desktop router restores the last route for the signed-in
account, and the layout restores the workspace view and selected thread.
Query strings and access tokens are excluded from saved navigation. Local
navigation is remembered separately. Sign-out destroys the web view and clears
its browser storage.

For development, build the shared bundle before starting Electron:

```sh
npm --prefix workspace/frontend run build:desktop
npm --prefix packages/launcher run dev
```

Rebuild the desktop bundle after shared web changes. Restart Electron after
changing main or preload code; a renderer refresh cannot update those bridges.
The launcher production build runs the shared build automatically, then
`scripts/check-workspace-bundle.mjs` fails the build if the bundle is missing.
CI installs the shared frontend's dependencies through
`.github/actions/workspace-frontend-deps`, and the `Workspace Desktop Bundle`
workflow builds the bundle on pull requests that touch it.

Without a bundle, a dev build shows the hosted Workspace so other launcher work
can continue; This Computer actions are unavailable there, because the hosted
page is not the bundle's origin. An installed app refuses to do this and shows
a reinstall message instead.

The API must allow the bundle's origin: `CORS_ORIGINS` needs
`openagents://workspace`. Until the deployment has it, `allowBundleApiAccess`
rewrites the CORS headers for requests the bundle makes.

## Shared agent management

`workspace/frontend/components/agents/agent-setup.tsx` owns the agent catalogue,
selection, device context, name, working folder, validation, and save flow. Both
Workspace nodes and the local launcher import it directly. Keep service calls
behind `AgentSetupApi`; the component must not import workspace auth or an API
singleton. Workspace model-access and credit offers are optional render slots.

The launcher’s `pages/agents/local-agent-setup.tsx` supplies its installed-core
catalogue, native folder picker, and existing account-sign-in/model/credential
controls. `local-setup-api.ts` uses existing launcher IPC, works without an
OpenAgents account, reuses installations, and changes only edited instance
settings. It never rewrites a workspace binding when saving configuration.
The old separate create/configure dialogs have been removed.

This Computer opens a device overview with its agents and connected workspaces;
there is no separate Agents page. Agent Marketplace in the rail installs and
updates agents and carries the update count; OpenAgents' own updates stay in
Settings → Updates.
Workspace setup continues to manage the selected device through the service;
its first-agent handoff opens a conversation only after the agent joins.

The launcher renderer aliases `@/` to the shared frontend and includes only the
editor’s UI/i18n dependencies in its typecheck. React and UI runtime packages
are deduplicated, and Tailwind scans the shared components. No new privileged
bridge is exposed to the hosted Workspace page.

`e2e/shared-agent-setup.spec.ts` exercises the built local UI with an in-memory
backend and blocked external requests. It verifies account-free creation,
folder selection, and saving existing settings without overwriting credentials.
