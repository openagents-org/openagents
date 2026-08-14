-- Platform gateway schema.
--
-- Four tables. Conversation mapping is deliberately absent: it has to be
-- created in the same transaction as the OA channel it points at, so it lives
-- in the backend and we ask for it by conversation identifiers instead.

CREATE TABLE IF NOT EXISTS platform_installations (
    id               TEXT PRIMARY KEY,
    platform         TEXT NOT NULL,             -- slack | lark | telegram
    -- Which app, as the platform names it. Slack sends api_app_id alongside
    -- team_id; Telegram has no app concept, so the bot id stands in. Part of
    -- the key because one agent gets one app: the same Slack workspace can
    -- hold several of ours, one per exported agent.
    platform_app_id  TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,             -- Slack team / Lark tenant / Telegram bot scope
    -- Encrypted. The gateway is the only holder of platform credentials; the
    -- backend keeps non-secret binding metadata and nothing else.
    credentials      TEXT NOT NULL,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, platform_app_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS bindings (
    -- Issued by the backend, which is the system of record for what a binding
    -- means. We hold the operational half.
    id               TEXT PRIMARY KEY,
    installation_id  TEXT NOT NULL REFERENCES platform_installations(id) ON DELETE CASCADE,
    oa_workspace_id  TEXT NOT NULL,
    oa_agent_name    TEXT NOT NULL,
    -- Encrypted. We generate this secret and hand the backend only its
    -- fingerprint, so there is no plaintext on their side to leak and a lost
    -- activation response is a plain retry rather than an unrecoverable state.
    integration_key  TEXT NOT NULL,
    -- Where outbound reading has reached. Advanced only after the events it
    -- covers are durably in the outbox.
    cursor           TEXT,
    -- Held by whichever replica is currently draining this binding, so two
    -- cannot advance the same cursor.
    lease_owner      TEXT,
    lease_expires_at TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'active',   -- active | disconnecting | disconnected
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bindings_status ON bindings (status);
CREATE INDEX IF NOT EXISTS idx_bindings_installation ON bindings (installation_id);

-- Inbound: written before the webhook is acknowledged, so a platform retry
-- collides here instead of producing a second OA message.
CREATE TABLE IF NOT EXISTS inbound_deliveries (
    id                TEXT PRIMARY KEY,
    platform          TEXT NOT NULL,
    installation_id   TEXT NOT NULL REFERENCES platform_installations(id) ON DELETE CASCADE,
    -- Slack's event_id is globally unique; Telegram's update_id is a per-bot
    -- sequence. Scoping to the installation is what makes one key work for
    -- both without collisions.
    external_event_id TEXT NOT NULL,
    payload           JSONB NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    attempts          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error        TEXT,
    oa_event_id       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, installation_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_due ON inbound_deliveries (status, next_attempt_at);

-- Outbound: a row must exist before anything is sent, so a crash between
-- sending and recording cannot silently repeat the message.
CREATE TABLE IF NOT EXISTS outbound_deliveries (
    id                  TEXT PRIMARY KEY,
    binding_id          TEXT NOT NULL REFERENCES bindings(id) ON DELETE CASCADE,
    oa_event_id         TEXT NOT NULL,
    external_key        TEXT,
    payload             JSONB NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    attempts            INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error          TEXT,
    external_message_id TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (binding_id, oa_event_id)
);

CREATE INDEX IF NOT EXISTS idx_outbound_due ON outbound_deliveries (status, next_attempt_at);
