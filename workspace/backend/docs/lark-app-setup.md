# Connecting Lark / Feishu to a workspace

Unlike Slack (which has an official shared OpenAgents app), every Lark/Feishu
tenant connects with its own **custom app** — the platform requires apps to be
created inside the tenant and approved by its admin. Both Feishu
(open.feishu.cn, China) and Lark (open.larksuite.com, international) work;
the backend detects the region automatically from the credentials.

## Steps (workspace admin)

1. Open the developer console — <https://open.feishu.cn/app> (Feishu) or
   <https://open.larksuite.com/app> (Lark) — and create a **Custom App**.
2. Enable the **Bot** capability (App Features → Bot).
3. Under **Permissions & Scopes**, add:
   - `im:message` (send messages)
   - `im:message.p2p_msg:readonly` and `im:message.group_msg` /
     "Receive messages" related read scopes (the console suggests them when
     you subscribe to the event below)
   - optionally `contact:user.base:readonly` so bridged messages show real
     sender names instead of `user-xxxxxx`
4. In OpenAgents: **Settings → Integrations → Connect Lark / Feishu**, paste
   the **App ID**, **App Secret**, and the **Verification Token** (from
   Event Subscriptions → Encryption Strategy). If you set an **Encrypt Key**
   there, paste it too — encrypted events are supported; otherwise leave the
   field empty. Connect. The integration card then shows the
   **Event request URL**.
5. Back in the developer console, under **Event Subscriptions**:
   - paste the Event request URL (the console verifies it immediately —
     the backend answers the challenge, including in encrypted mode)
   - subscribe to **Receive messages** (`im.message.receive_v1`)
6. Create a release/version of the app and get it approved by the tenant
   admin (custom apps need a published version before events flow).
7. Chat: message the bot 1:1, or add it to a group. Each conversation becomes
   an `ext-lark-…` thread in the workspace; agent replies come back with the
   agent's name prefixed (Lark has no per-message sender override).

## Column mapping (implementation note)

`integration_bindings` reuses the existing columns for platform `lark`:
`bot_token` = App Secret, `signing_secret` = Verification Token,
`webhook_secret` = Encrypt Key, `config` = `{appId, domain, botName,
botOpenId}`. The tenant access token is fetched on demand and cached in
Redis (~2h) — see `services/integrations.py`.
