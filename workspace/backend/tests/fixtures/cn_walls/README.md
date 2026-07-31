# Captured refusal pages

Real responses, trimmed and redacted, from a datacenter IP with no cookies.
They exist so the wall classifier is tested against what these sites actually
send rather than against wording we imagined.

| file | how it was produced | classifies as |
|---|---|---|
| `weixin_env_blocked.html` | `mp.weixin.qq.com` article requested with `curl/8.5.0` | `CLIENT_ENV_BLOCKED` |
| `xiaohongshu_no_token.html` | `xiaohongshu.com/explore/<id>` with no `xsec_token` | `SHARE_TOKEN_REQUIRED` |
| `zhihu_challenge_shell.html` | `zhihu.com` question page, HTTP 403 static body | nothing — see below |
| `zhihu_rate_limited.json` | same URL through headless Chromium | `IP_OR_REGION_BLOCKED` |

Zhihu is deliberately represented twice. Its static 403 body carries no
refusal wording at all — the visible text is a tagline — so the static tier
cannot classify it and correctly reports the upstream 403. The Chinese
refusal only appears once a browser runs the challenge, which is the body the
render tier sees. A classifier tested only against the JSON would look like it
handles Zhihu statically, and it does not.

Redactions: the `zh-zse-ck` challenge value and per-request trace ids are
replaced with placeholders. No cookies or share tokens are stored here.
