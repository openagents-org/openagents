"""
Agent-level agent discovery adapter for OpenAgents.

This adapter allows agents to announce their capabilities to the network
and for other agents to discover agents with specific capabilities.

Features:
- Set and get capabilities
- Search for agents by capability filter
- List all connected agents
- Receive connection/disconnection notifications
"""

import logging
import copy
from typing import Dict, Any, Optional, List

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Mod constants
MOD_NAME = "openagents.mods.discovery.agent_discovery"


class AgentDiscoveryAdapter(BaseModAdapter):
    """Agent adapter for the agent discovery mod.

    This adapter allows agents to announce their capabilities and
    discover other agents with specific capabilities.
    """

    def __init__(self):
        """Initialize the agent discovery adapter."""
        super().__init__(MOD_NAME)
        self._capabilities: Dict[str, Any] = {}

    def initialize(self) -> bool:
        """Initialize the mod adapter.

        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing {self.mod_name} adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod adapter gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down {self.mod_name} adapter for agent {self.agent_id}")
        return True

    async def on_connect(self) -> None:
        """Called when the mod adapter is connected to the network.

        Announces the agent's capabilities when connecting to the network.
        """
        if self._capabilities:
            await self.set_capabilities(self._capabilities)
            logger.info(f"Agent {self.agent_id} connected and announced capabilities")

    async def set_capabilities(self, capabilities: Dict[str, Any]) -> Dict[str, Any]:
        """Set the capabilities for this agent.

        Args:
            capabilities: The capabilities to set

        Returns:
            Dict with success status and updated capabilities
        """
        self._capabilities = copy.deepcopy(capabilities)
        logger.info(f"Agent {self.agent_id} setting capabilities")

        if not self.connector or not self.connector.is_connected:
            return {
                "success": True,
                "message": "Capabilities stored locally, will announce on connect",
                "data": {"capabilities": self._capabilities}
            }

        # Send capabilities set event
        event = Event(
            event_name="discovery.capabilities.set",
            source_id=self.agent_id,
            payload={"capabilities": copy.deepcopy(capabilities)}
        )

        response = await self.connector.send_event(event)

        if response:
            return {
                "success": response.success,
                "message": response.message,
                "data": response.data
            }

        return {
            "success": True,
            "message": "Capabilities set request sent",
            "data": {"capabilities": self._capabilities}
        }

    async def announce_skills(self, skills: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Announce agent skills in A2A-compatible format.

        This method allows local agents to announce their skills in a structured
        format compatible with A2A AgentSkill, enabling capability-based routing
        to work seamlessly across both A2A and local agents.

        Args:
            skills: List of skill dictionaries with A2A-compatible structure.
                Each skill should have:
                - id (str, required): Unique skill identifier
                - name (str, required): Human-readable skill name
                - description (str, optional): Skill description
                - tags (List[str], optional): Categorization tags
                - input_modes (List[str], optional): Supported input modes (default: ["text"])
                - output_modes (List[str], optional): Supported output modes (default: ["text"])

        Returns:
            Dict with success status and the structured capabilities

        Example:
            await adapter.announce_skills([
                {
                    "id": "translation",
                    "name": "Document Translation",
                    "description": "Translate documents between languages",
                    "tags": ["language", "nlp"],
                    "input_modes": ["text", "file"],
                    "output_modes": ["text"]
                },
                {
                    "id": "summarization",
                    "name": "Text Summarization",
                    "tags": ["nlp"]
                }
            ])
        """
        # Normalize skills to ensure all fields have defaults
        normalized_skills = []
        for skill in skills:
            normalized_skill = {
                "id": skill.get("id", ""),
                "name": skill.get("name", skill.get("id", "")),
                "description": skill.get("description"),
                "tags": skill.get("tags", []),
                "input_modes": skill.get("input_modes", ["text"]),
                "output_modes": skill.get("output_modes", ["text"]),
            }
            normalized_skills.append(normalized_skill)

        # Aggregate tags and modes across all skills
        all_tags = set()
        all_input_modes = set()
        all_output_modes = set()

        for skill in normalized_skills:
            all_tags.update(skill.get("tags", []))
            all_input_modes.update(skill.get("input_modes", ["text"]))
            all_output_modes.update(skill.get("output_modes", ["text"]))

        # Build structured capabilities
        capabilities = {
            "skills": normalized_skills,
            "tags": list(all_tags),
            "input_modes": list(all_input_modes),
            "output_modes": list(all_output_modes),
        }

        logger.info(
            f"Agent {self.agent_id} announcing {len(normalized_skills)} skills "
            f"with tags={list(all_tags)}"
        )

        return await self.set_capabilities(capabilities)

    async def get_capabilities(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get capabilities of a specific agent.

        Args:
            agent_id: The ID of the agent to get capabilities for

        Returns:
            Agent capabilities or None if not found
        """
        if not self.connector or not self.connector.is_connected:
            logger.warning(
                f"Agent {self.agent_id} cannot get capabilities: not connected"
            )
            return None

        event = Event(
            event_name="discovery.capabilities.get",
            source_id=self.agent_id,
            payload={"agent_id": agent_id}
        )

        response = await self.connector.send_event(event)

        if response and response.success:
            return response.data.get("capabilities")
        
        return None

    async def search_agents(
        self, filter: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Search for agents with specific capabilities.

        Args:
            filter: Capability filter for searching agents

        Returns:
            List of matching agents with their capabilities
        """
        if not self.connector or not self.connector.is_connected:
            logger.warning(
                f"Agent {self.agent_id} cannot search agents: not connected"
            )
            return []

        event = Event(
            event_name="discovery.agents.search",
            source_id=self.agent_id,
            payload={"filter": filter}
        )

        response = await self.connector.send_event(event)

        if response and response.success:
            return response.data.get("agents", [])
        
        return []

    async def list_agents(
        self, filter: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """List all connected agents.

        Args:
            filter: Optional capability filter

        Returns:
            List of all agents with their capabilities
        """
        if not self.connector or not self.connector.is_connected:
            logger.warning(
                f"Agent {self.agent_id} cannot list agents: not connected"
            )
            return []

        payload = {}
        if filter:
            payload["filter"] = filter

        event = Event(
            event_name="discovery.agents.list",
            source_id=self.agent_id,
            payload=payload
        )

        response = await self.connector.send_event(event)

        if response and response.success:
            return response.data.get("agents", [])
        
        return []

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """Process an incoming event.

        Args:
            event: The event to process

        Returns:
            The processed event or None to stop processing
        """
        # Handle discovery notifications if needed
        if event.event_name.startswith("discovery.notification."):
            # Let the event pass through to the agent's event handlers
            return event

        return event

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List of tools provided by this adapter
        """
        tools = []

        # Tool for setting capabilities
        set_capabilities_tool = AgentTool(
            name="set_capabilities",
            description="Set this agent's capabilities for discovery by other agents",
            input_schema={
                "type": "object",
                "properties": {
                    "capabilities": {
                        "type": "object",
                        "description": "Capabilities to set for this agent"
                    }
                },
                "required": ["capabilities"]
            },
            func=self.set_capabilities
        )
        tools.append(set_capabilities_tool)

        # Tool for announcing skills in A2A-compatible format
        announce_skills_tool = AgentTool(
            name="announce_skills",
            description=(
                "Announce agent skills in A2A-compatible format for capability-based routing. "
                "This enables the task delegation mod to route tasks based on skills."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "skills": {
                        "type": "array",
                        "description": "List of skills in A2A-compatible format",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "Unique skill identifier"
                                },
                                "name": {
                                    "type": "string",
                                    "description": "Human-readable skill name"
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Skill description"
                                },
                                "tags": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Categorization tags"
                                },
                                "input_modes": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Supported input modes (default: ['text'])"
                                },
                                "output_modes": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Supported output modes (default: ['text'])"
                                }
                            },
                            "required": ["id", "name"]
                        }
                    }
                },
                "required": ["skills"]
            },
            func=self.announce_skills
        )
        tools.append(announce_skills_tool)

        # Tool for getting capabilities
        get_capabilities_tool = AgentTool(
            name="get_agent_capabilities",
            description="Get the capabilities of a specific agent",
            input_schema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "ID of the agent to get capabilities for"
                    }
                },
                "required": ["agent_id"]
            },
            func=self.get_capabilities
        )
        tools.append(get_capabilities_tool)

        # Tool for searching agents
        search_agents_tool = AgentTool(
            name="search_agents",
            description="Search for agents with specific capabilities",
            input_schema={
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "object",
                        "description": "Capability filter for searching agents"
                    }
                },
                "required": ["filter"]
            },
            func=self.search_agents
        )
        tools.append(search_agents_tool)

        # Tool for listing agents
        list_agents_tool = AgentTool(
            name="list_agents",
            description="List all connected agents on the network",
            input_schema={
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "object",
                        "description": "Optional capability filter"
                    }
                },
                "required": []
            },
            func=self.list_agents
        )
        tools.append(list_agents_tool)

        return tools
