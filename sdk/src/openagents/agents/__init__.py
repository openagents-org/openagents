"""
OpenAgents agent classes and utilities.
"""

from .runner import AgentRunner
from .worker_agent import WorkerAgent
from .project_echo_agent import ProjectEchoAgentRunner
from .langchain_agent import (
    LangChainAgentRunner,
    create_langchain_runner,
    openagents_tool_to_langchain,
    langchain_tool_to_openagents,
)
from .llamaindex_agent import (
    LlamaIndexAgentRunner,
    create_llamaindex_runner,
    openagents_tool_to_llamaindex,
    llamaindex_tool_to_openagents,
)
from .crewai_agent import (
    CrewAIAgentRunner,
    create_crewai_runner,
    openagents_tool_to_crewai,
    crewai_tool_to_openagents,
)
from .pydantic_ai_agent import (
    PydanticAIAgentRunner,
    create_pydantic_runner,
    openagents_tool_to_pydantic,
    pydantic_tool_to_openagents,
)

__all__ = [
    "AgentRunner",
    "WorkerAgent",
    "ProjectEchoAgentRunner",
    # LangChain integration
    "LangChainAgentRunner",
    "create_langchain_runner",
    "openagents_tool_to_langchain",
    "langchain_tool_to_openagents",
    # LlamaIndex integration
    "LlamaIndexAgentRunner",
    "create_llamaindex_runner",
    "openagents_tool_to_llamaindex",
    "llamaindex_tool_to_openagents",
    # CrewAI integration
    "CrewAIAgentRunner",
    "create_crewai_runner",
    "openagents_tool_to_crewai",
    "crewai_tool_to_openagents",
    # PydanticAI integration
    "PydanticAIAgentRunner",
    "create_pydantic_runner",
    "openagents_tool_to_pydantic",
    "pydantic_tool_to_openagents",
]
