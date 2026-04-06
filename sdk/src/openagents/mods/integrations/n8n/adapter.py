import logging
from typing import List, Dict, Any, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.tool import AgentTool
from openagents.utils.n8n_client import N8nClient

logger = logging.getLogger(__name__)

class N8nAgentAdapter(BaseModAdapter):
    """Agent adapter for n8n integration.
    
    Allows agents to trigger n8n workflows and interact with n8n-hosted AI agents.
    """

    def __init__(self):
        super().__init__("n8n")
        self.n8n_client = None

    def initialize(self) -> bool:
        """Initialize the n8n adapter."""
        base_url = self.config.get("base_url")
        api_key = self.config.get("api_key")
        self.n8n_client = N8nClient(base_url=base_url, api_key=api_key)
        logger.info(f"N8nAgentAdapter initialized for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the n8n adapter."""
        logger.info(f"Shutting down N8nAgentAdapter for agent {self.agent_id}")
        self.n8n_client = None
        return True

    async def call_n8n_workflow(self, workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Trigger an n8n workflow via webhook.
        
        Args:
            workflow_id: The ID or path part of the n8n webhook URL.
            payload: The data to send to the workflow.
        """
        logger.info(f"Calling n8n workflow: {workflow_id}")
        return await self.n8n_client.call_workflow(workflow_id, payload)

    async def interact_with_n8n_agent(self, session_id: str, message: str) -> Dict[str, Any]:
        """Interact with an n8n AI Agent node.
        
        Args:
            session_id: Unique session identifier for the chat.
            message: The message to send to the agent.
        """
        logger.info(f"Interacting with n8n agent. Session: {session_id}")
        return await self.n8n_client.interact_with_agent(session_id, message)

    def get_tools(self) -> List[AgentTool]:
        """Return the tools provided by this adapter."""
        return [
            AgentTool(
                name="call_n8n_workflow",
                description="Trigger an n8n workflow via a webhook URL.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "workflow_id": {
                            "type": "string",
                            "description": "The ID or path part of the n8n webhook URL (e.g., 'my-workflow-123')."
                        },
                        "payload": {
                            "type": "object",
                            "description": "The JSON payload to send to the workflow."
                        }
                    },
                    "required": ["workflow_id", "payload"]
                },
                func=self.call_n8n_workflow
            ),
            AgentTool(
                name="interact_with_n8n_agent",
                description="Send a message to an n8n-hosted AI Agent and get a response.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "session_id": {
                            "type": "string",
                            "description": "A unique identifier for the conversation session."
                        },
                        "message": {
                            "type": "string",
                            "description": "The message to send to the n8n AI agent."
                        }
                    },
                    "required": ["session_id", "message"]
                },
                func=self.interact_with_n8n_agent
            )
        ]

