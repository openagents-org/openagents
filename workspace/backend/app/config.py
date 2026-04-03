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

    # LLM Router — uses a small model to decide agent turn-taking in multi-agent threads
    # Provider: "anthropic" (default) or "openai" (any OpenAI-compatible endpoint)
    ROUTER_LLM_ENABLED: bool = os.environ.get("ROUTER_LLM_ENABLED", "true").lower() in ("true", "1", "yes")
    ROUTER_LLM_PROVIDER: str = os.environ.get("ROUTER_LLM_PROVIDER", "anthropic")  # "anthropic" or "openai"
    ROUTER_LLM_MODEL: str = os.environ.get("ROUTER_LLM_MODEL", "")  # auto-detected from provider if empty
    ROUTER_LLM_API_KEY: str = os.environ.get("ROUTER_LLM_API_KEY", "")  # universal key (checked first)
    ROUTER_LLM_BASE_URL: str = os.environ.get("ROUTER_LLM_BASE_URL", "")  # custom endpoint for openai provider
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")  # fallback for anthropic provider

    # Server
    HOST: str = os.environ.get("HOST", "0.0.0.0")
    PORT: int = int(os.environ.get("PORT", "8000"))


config = Config()
