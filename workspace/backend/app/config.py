# -*- coding: utf-8 -*-
"""
Workspace backend configuration.

All settings are loaded from environment variables.
"""

import os


class Config:
    """Application configuration loaded from environment variables."""

    # Database
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:dev@localhost:5432/openagents_workspace",
    )

    # Auth mode: "workspace_token" (self-hosted) or "firebase" (hosted)
    AUTH_MODE: str = os.environ.get("AUTH_MODE", "workspace_token")

    # Firebase (used for user login on workspace.openagents.org)
    FIREBASE_PROJECT_ID: str = os.environ.get("FIREBASE_PROJECT_ID", "openagentsweb")

    # Optional: Firebase service account credentials as JSON string
    FIREBASE_CREDENTIALS_JSON: str = os.environ.get("FIREBASE_CREDENTIALS_JSON", "")

    # Sign in with Apple. Native ("Sign in with Apple" on the iOS app) issues an
    # identity token whose `aud` is the app's bundle id; web/services flows use
    # the Services ID instead. Accept a comma-separated allowlist so both work.
    # Defaults to the iOS bundle id so the OpenAgents Go app validates out of the
    # box without extra env config.
    APPLE_CLIENT_IDS: str = os.environ.get(
        "APPLE_CLIENT_IDS", "org.openagents.workspace"
    )

    # APNs (Apple Push Notification service) — direct, no FCM in between.
    # Token-based auth via a .p8 key generated at
    # developer.apple.com/account/resources/authkeys/list.
    # APNS_AUTH_KEY contains the raw PEM body ("-----BEGIN PRIVATE KEY-----\n...");
    # for local dev set APNS_AUTH_KEY_PATH instead to point at the .p8 file on disk.
    APNS_AUTH_KEY: str = os.environ.get("APNS_AUTH_KEY", "")
    APNS_AUTH_KEY_PATH: str = os.environ.get("APNS_AUTH_KEY_PATH", "")
    APNS_KEY_ID: str = os.environ.get("APNS_KEY_ID", "")
    APNS_TEAM_ID: str = os.environ.get("APNS_TEAM_ID", "")
    APNS_BUNDLE_ID: str = os.environ.get("APNS_BUNDLE_ID", "org.openagents.workspace")
    # "sandbox" for TestFlight / dev builds, "production" for App Store.
    # One Apple key works for both; this picks which APNs host to hit.
    APNS_ENVIRONMENT: str = os.environ.get("APNS_ENVIRONMENT", "production")

    # Identity mode: "standalone" (own agent table) or "shared" (external agent_ids)
    IDENTITY_MODE: str = os.environ.get("IDENTITY_MODE", "standalone")

    # Agent offline timeout in seconds
    AGENT_TIMEOUT_SECONDS: int = int(os.environ.get("AGENT_TIMEOUT_SECONDS", "60"))

    # CORS origins (comma-separated)
    CORS_ORIGINS: str = os.environ.get("CORS_ORIGINS", "*")

    # File storage
    FILE_STORAGE_BACKEND: str = os.environ.get("FILE_STORAGE_BACKEND", "local")  # "local" or "s3"
    FILE_STORAGE_PATH: str = os.environ.get("FILE_STORAGE_PATH", "/tmp/openagents_files")
    S3_BUCKET: str = os.environ.get("S3_BUCKET", "")
    S3_REGION: str = os.environ.get("S3_REGION", "us-east-1")
    MAX_FILE_SIZE: int = int(os.environ.get("MAX_FILE_SIZE", str(50 * 1024 * 1024)))  # 50MB

    # User avatars. Separate limits from MAX_FILE_SIZE on purpose — a 50MB
    # avatar upload is never legitimate, and every accepted byte here gets
    # decoded into a pixel buffer.
    AVATAR_MAX_UPLOAD_SIZE: int = int(os.environ.get("AVATAR_MAX_UPLOAD_SIZE", str(5 * 1024 * 1024)))  # 5MB
    # Decompression-bomb ceiling: a few KB of PNG can expand to gigabytes of
    # pixels, so this is checked against img.size before any pixel work.
    AVATAR_MAX_PIXELS: int = int(os.environ.get("AVATAR_MAX_PIXELS", str(25_000_000)))
    # Decoding is CPU- and memory-heavy, so it runs under a semaphore. NOTE:
    # that semaphore is PER PROCESS — with N uvicorn workers the real ceiling is
    # N x this. Worst-case memory is roughly N x this x (AVATAR_MAX_PIXELS x 4B).
    # Tune against the actual ECS task memory rather than trusting the default.
    AVATAR_DECODE_CONCURRENCY: int = int(os.environ.get("AVATAR_DECODE_CONCURRENCY", "4"))
    AVATAR_SIZE: int = int(os.environ.get("AVATAR_SIZE", "512"))          # output edge, px
    # Browser cache lifetime. This is the revocation window: once a viewer has
    # the bytes, removing the avatar can't reach their cache until this expires.
    # Deliberately NOT `immutable` + 1 year — that would mean "never revocable".
    AVATAR_CACHE_MAX_AGE: int = int(os.environ.get("AVATAR_CACHE_MAX_AGE", str(24 * 60 * 60)))  # 24h

    # LLM Router — uses a small model to decide agent turn-taking in multi-agent threads
    # Provider: "anthropic" (default) or "openai" (any OpenAI-compatible endpoint)
    ROUTER_LLM_ENABLED: bool = os.environ.get("ROUTER_LLM_ENABLED", "true").lower() in ("true", "1", "yes")
    ROUTER_LLM_PROVIDER: str = os.environ.get("ROUTER_LLM_PROVIDER", "anthropic")  # "anthropic" or "openai"
    ROUTER_LLM_MODEL: str = os.environ.get("ROUTER_LLM_MODEL", "")  # auto-detected from provider if empty
    ROUTER_LLM_API_KEY: str = os.environ.get("ROUTER_LLM_API_KEY", "")  # universal key (checked first)
    ROUTER_LLM_BASE_URL: str = os.environ.get("ROUTER_LLM_BASE_URL", "")  # custom endpoint for openai provider
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")  # fallback for anthropic provider

    # Cloud agents
    CLOUD_AGENT_MAX_CONTEXT_MESSAGES: int = int(os.environ.get("CLOUD_AGENT_MAX_CONTEXT_MESSAGES", "10"))
    CLOUD_AGENT_MAX_DEPTH: int = int(os.environ.get("CLOUD_AGENT_MAX_DEPTH", "3"))

    # Yumi — first-party built-in onboarding assistant (a cloud agent auto-added
    # to every workspace). Its credentials are SERVER-HELD and shared across all
    # workspaces: never persisted per-workspace and never exposed to the frontend.
    # Yumi is only provisioned when enabled AND a key is configured, so
    # self-hosted deployments without a key simply don't get it.
    YUMI_ENABLED: bool = os.environ.get("YUMI_ENABLED", "true").lower() in ("true", "1", "yes")
    YUMI_API_KEY: str = os.environ.get("YUMI_API_KEY", "")
    YUMI_BASE_URL: str = os.environ.get("YUMI_BASE_URL", "https://api-gateway.openagents.org/v1")
    YUMI_MODEL: str = os.environ.get("YUMI_MODEL", "deepseek-v4-pro")
    # Safety cap on the tool-calling loop per user message.
    YUMI_MAX_TOOL_ITERATIONS: int = int(os.environ.get("YUMI_MAX_TOOL_ITERATIONS", "6"))

    # Google OAuth (for "Sign in with Google" Gemini integration)
    GOOGLE_OAUTH_CLIENT_ID: str = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    GOOGLE_OAUTH_CLIENT_SECRET: str = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    GOOGLE_OAUTH_REDIRECT_URI: str = os.environ.get(
        "GOOGLE_OAUTH_REDIRECT_URI",
        "https://workspace-endpoint.openagents.org/v1/cloud-agents/google/callback",
    )

    # Server
    HOST: str = os.environ.get("HOST", "0.0.0.0")
    PORT: int = int(os.environ.get("PORT", "8000"))


config = Config()
