"""
Kimi adapter for OpenAgents workspace — Moonshot AI OpenAI-compatible API.

Mirrors packages/agent-connector/src/adapters/kimi.js. Reuses the streaming
chat-completions client from LlmDirectAdapter but applies Kimi-specific
defaults (base URL https://api.moonshot.ai/v1, model kimi-k2.6) and accepts
KIMI_API_KEY / MOONSHOT_API_KEY in addition to the generic LLM_*/OPENAI_*
variables.

Priority for every value: UI-saved env > process env > default.
"""

import logging
import os

from openagents.adapters.llm_direct import LlmDirectAdapter
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"
DEFAULT_MODEL = "kimi-k2.6"


class KimiAdapter(LlmDirectAdapter):
    """Kimi (Moonshot) adapter — OpenAI-compatible chat completions."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        disabled_modules: set | None = None,
        working_dir: str | None = None,
    ):
        super().__init__(
            workspace_id,
            channel_name,
            token,
            agent_name,
            endpoint,
            disabled_modules,
            working_dir,
        )

        self._direct_api_key = (
            os.environ.get("KIMI_API_KEY")
            or os.environ.get("MOONSHOT_API_KEY")
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or ""
        )
        self._direct_base_url = (
            os.environ.get("KIMI_BASE_URL")
            or os.environ.get("LLM_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self._direct_model = (
            os.environ.get("KIMI_MODEL")
            or os.environ.get("LLM_MODEL")
            or DEFAULT_MODEL
        )
        self._direct_mode = bool(self._direct_api_key and self._direct_base_url)

        if self._direct_mode:
            logger.info(
                f"Kimi mode: {self._direct_base_url} model={self._direct_model}"
            )
        else:
            logger.warning(
                "Kimi adapter started without API key. "
                "Set KIMI_API_KEY (or MOONSHOT_API_KEY) via the Launcher Configure screen."
            )
