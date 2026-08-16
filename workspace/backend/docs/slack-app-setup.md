# Official "OpenAgents" Slack app — one-time setup

The workspace UI offers a one-click **Add to Slack** button. It works by
sharing a single, officially registered Slack app across every OpenAgents
workspace: users go through Slack's OAuth consent screen instead of creating
their own app. This document is the one-time registration procedure for the
person operating the deployment (needs a Slack account that can create apps).

Until these steps are done (i.e. the env vars below are unset), the UI
automatically falls back to the bring-your-own-app flow, which keeps working
either way — it is also what self-hosted deployments without an official app
use.

## 1. Create the app from a manifest

Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**,
pick any Slack workspace as the dev home, and paste:

```yaml
display_information:
  name: OpenAgents
  description: Chat with your OpenAgents workspace agents from Slack
  background_color: "#1a1a2e"
features:
  bot_user:
    display_name: OpenAgents
    always_online: true
oauth_config:
  redirect_urls:
    - https://workspace-endpoint.openagents.org/v1/integrations/slack/oauth/callback
  scopes:
    bot:
      - chat:write
      - chat:write.customize
      - users:read
      - im:history
      - channels:history
      - groups:history
settings:
  event_subscriptions:
    request_url: https://workspace-endpoint.openagents.org/v1/integrations/slack/events
    bot_events:
      - message.im
      - message.channels
      - message.groups
      - app_uninstalled
      - tokens_revoked
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Slack verifies the events `request_url` on save — the backend answers the
`url_verification` handshake automatically, so the backend with the
`SLACK_SIGNING_SECRET` env var (step 3) must be deployed FIRST. Order:
deploy backend with env vars → then save the manifest / request URL.
(Creating the app first to obtain the credentials, deploying, then saving
the manifest again also works.)

## 2. Enable public distribution

Under **Manage Distribution** → activate public distribution. Without this,
only the app's home Slack workspace can install it. A Slack Marketplace
listing is NOT required — unlisted distributed apps install fine via our
OAuth URL.

## 3. Set the backend env vars (Railway `workspace-backend`)

From the app's **Basic Information** page:

| Env var               | Source                    |
|-----------------------|---------------------------|
| `SLACK_CLIENT_ID`     | App Credentials → Client ID |
| `SLACK_CLIENT_SECRET` | App Credentials → Client Secret |
| `SLACK_SIGNING_SECRET`| App Credentials → Signing Secret |

Redeploy. The Integrations settings page then shows **Add to Slack**
(`slackAppConfigured: true` in `GET …/integrations`).

## How the flow works (for reference)

1. Admin clicks **Add to Slack** → frontend fetches
   `GET /v1/workspaces/{id}/integrations/slack/install-url` (admin-authed),
   which returns `https://slack.com/oauth/v2/authorize?...` with an
   HMAC-signed `state` carrying the workspace id (10 min TTL).
2. User approves on Slack → Slack redirects the browser to
   `GET /v1/integrations/slack/oauth/callback?code&state`.
3. Backend verifies `state`, exchanges the code (`oauth.v2.access`), and
   upserts the `integration_bindings` row keyed by (workspace, team id) —
   re-installs rotate the token in place.
4. Browser is redirected back to
   `{FRONTEND_BASE_URL}/{workspace}/settings/integrations?slack=connected`.
5. All of the installed teams' events arrive at the shared
   `POST /v1/integrations/slack/events` (verified with the global signing
   secret) and are routed to bindings by `team_id`. `app_uninstalled` /
   `tokens_revoked` disable the binding and surface it in the UI.
