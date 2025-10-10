import os
import logging
from typing import List

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import ChannelMessageContext


logger = logging.getLogger(__name__)


class ChinesePoetAgent(WorkerAgent):
    """Compose classical-style Chinese poems via LLM based on incoming messages."""

    default_agent_id = "shici-poet"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.keywords = self._build_keyword_list()

    async def on_startup(self):
        ws = self.workspace()
        await ws.channel("general").post(
            "诗词小助手已上线，请发送关键词（如春、山、月、酒、风、雨）召唤一首新诗。"
        )

    async def on_channel_post(self, context: ChannelMessageContext):
        ws = self.workspace()
        extracted = self._extract_keywords(context.text)

        instruction_override = self._build_instruction(extracted)

        configured_api_key = getattr(self.agent_config, "api_key", None)
        effective_api_key = (
            configured_api_key
            or os.getenv("API_KEY")
            or os.getenv("AGENT_API_KEY")
            or os.getenv("OPENAI_API_KEY")
        )

        configured_base = getattr(self.agent_config, "api_base", None)
        effective_base = configured_base or os.getenv("BASE_URL") or os.getenv("AGENT_API_BASE")

        if not effective_api_key:
            logger.warning(
                "ChinesePoetAgent skipped LLM call: missing API key (API_KEY / AGENT_API_KEY / OPENAI_API_KEY)."
            )
            await ws.channel(context.channel).reply(
                context.message_id,
                "我需要在 .env 中配置 API_KEY 才能即兴作诗。请先补全密钥后再试～",
            )
            return

        if not configured_api_key:
            self.agent_config.api_key = effective_api_key
        if effective_base and not configured_base:
            self.agent_config.api_base = effective_base

        try:
            await self.run_agent(context=context, instruction=instruction_override)
        except Exception as exc:  # noqa: BLE001
            logger.error("Poet agent failed to invoke LLM: %s", exc)
            await ws.channel(context.channel).reply(
                context.message_id,
                "抱歉，诗兴暂时打烊了，请稍后再试。",
            )

    def _build_keyword_list(self) -> List[str]:
        return [
            "春",
            "夏",
            "秋",
            "冬",
            "山",
            "水",
            "江",
            "湖",
            "海",
            "月",
            "星",
            "风",
            "雨",
            "雪",
            "花",
            "柳",
            "酒",
            "梦",
            "夜",
            "云",
            "故乡",
            "旅",
        ]

    def _extract_keywords(self, text: str) -> List[str]:
        if not text:
            return []

        found = []
        for kw in self.keywords:
            if kw in text and kw not in found:
                found.append(kw)
        return found[:3]

    def _build_instruction(self, keywords: List[str]) -> str:
        if keywords:
            keyword_clause = "、".join(keywords)
            prompt = f"请围绕关键词：{keyword_clause} 创作一首四句的中国古典诗。"
        else:
            prompt = "请即兴创作一首表达友谊与鼓励的中国古典诗。"

        return (
            "你是一位擅长中国古典诗词的诗人。"
            "要求：\n"
            "1. 输出四句七言古体，语言典雅、押平仄韵。\n"
            "2. 诗句需连贯成完整意境，避免现代词汇。\n"
            "3. 最后一行之后附加括号内简短意境说明（不超过12字）。\n"
            f"4. {prompt}\n"
            "5. 只输出诗句与注释，不要额外说明。"
        )


if __name__ == "__main__":
    host = os.getenv("NETWORK_HOST", "localhost")
    port = int(os.getenv("NETWORK_PORT", "8700"))

    instruction = os.getenv(
        "AGENT_INSTRUCTION",
        "你是一位擅长创作中国古典诗词的诗人，能够根据主题写出雅正、含蓄的诗句。",
    )
    model_name = os.getenv("MODEL") or os.getenv("AGENT_MODEL_NAME") or "gpt-4o-mini"
    provider = os.getenv("PROVIDER", "openai")
    api_key = os.getenv("API_KEY") or os.getenv("AGENT_API_KEY")
    api_base = os.getenv("BASE_URL") or os.getenv("AGENT_API_BASE")

    agent_config = AgentConfig(
        instruction=instruction,
        model_name=model_name,
        provider=provider,
        api_key=api_key,
        react_to_all_messages=True,
    )

    if api_base:
        agent_config.api_base = api_base

    agent = ChinesePoetAgent(agent_config=agent_config)
    agent.start(network_host=host, network_port=port)
    agent.wait_for_stop()
