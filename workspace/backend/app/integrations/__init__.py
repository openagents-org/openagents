# -*- coding: utf-8 -*-
"""Platform-integration support (Slack / Lark / Telegram bridge).

The gateway is an internet-facing service we treat as semi-trusted: it holds
platform credentials and receives webhooks from the outside world, so its reach
into a workspace has to be bounded by us rather than by its own good behaviour.

Everything here exists to draw that boundary:

* ``principal`` — resolves a restricted credential into the single binding it
  stands for, and nothing more.
* ``conversations`` — turns the structured identifiers a webhook carries into
  a channel, deriving the name ourselves so two racing webhooks agree and a
  rebind can't inherit an earlier binding's history.

The endpoints in ``app/routers/integrations.py`` build on both and always
overwrite ``source``/``target``/``target_agents`` from the principal — no
request field, and no message body, can widen what a gateway may touch.
"""
