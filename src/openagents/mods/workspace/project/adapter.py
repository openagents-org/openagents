"""
Agent adapter for the project mod.

This adapter provides tools for agents to interact with the comprehensive
project management system including templates, lifecycle, state, and artifacts.
"""

import logging
import asyncio
from typing import TYPE_CHECKING, Dict, Any, List, Optional
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.tool import AgentTool
from openagents.models.event import Event
from openagents.workspace.project_messages import *
from .template_tools import generate_template_tools

if TYPE_CHECKING:
    from .mod import DefaultProjectNetworkMod

logger = logging.getLogger(__name__)


class DefaultProjectAgentAdapter(BaseModAdapter):
    """Agent adapter for project management functionality."""

    def __init__(self, mod_name: str = "project.default"):
        """Initialize the project agent adapter."""
        super().__init__(mod_name=mod_name)
        self._mod: Optional["DefaultProjectNetworkMod"] = None

    def bind_mod(self, mod: "DefaultProjectNetworkMod") -> None:
        """Bind this adapter to the network mod for template access.

        Args:
            mod: The DefaultProjectNetworkMod instance
        """
        self._mod = mod

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter."""
        tools = [
            # Template Management
            AgentTool(
                name="list_project_templates",
                description="List all available project templates",
                input_schema={
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False
                },
                func=self.list_project_templates
            ),
            
            # Project Lifecycle
            AgentTool(
                name="start_project",
                description="Start a new project from a template",
                input_schema={
                    "type": "object",
                    "properties": {
                        "template_id": {
                            "type": "string",
                            "description": "ID of the project template to use"
                        },
                        "goal": {
                            "type": "string",
                            "description": "The goal or description of the project"
                        },
                        "name": {
                            "type": "string",
                            "description": "Optional name for the project"
                        },
                        "collaborators": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional list of additional agent IDs to collaborate"
                        }
                    },
                    "required": ["template_id", "goal"],
                    "additionalProperties": False
                },
                func=self.start_project
            ),
            
            AgentTool(
                name="stop_project", 
                description="Stop a running project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to stop"
                        },
                        "reason": {
                            "type": "string",
                            "description": "Optional reason for stopping the project"
                        }
                    },
                    "required": ["project_id"],
                    "additionalProperties": False
                },
                func=self.stop_project
            ),
            
            AgentTool(
                name="complete_project",
                description="Mark a project as completed",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to complete"
                        },
                        "summary": {
                            "type": "string",
                            "description": "Summary of what was accomplished"
                        }
                    },
                    "required": ["project_id", "summary"],
                    "additionalProperties": False
                },
                func=self.complete_project
            ),
            
            AgentTool(
                name="get_project",
                description="Get detailed information about a project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to retrieve"
                        }
                    },
                    "required": ["project_id"],
                    "additionalProperties": False
                },
                func=self.get_project
            ),
            
            # Project Messaging
            AgentTool(
                name="send_project_message",
                description="Send a message to the project channel",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "content": {
                            "type": "object",
                            "properties": {
                                "text": {
                                    "type": "string",
                                    "description": "Message text content"
                                }
                            },
                            "required": ["text"],
                            "description": "Message content"
                        },
                        "reply_to_id": {
                            "type": "string",
                            "description": "Optional ID of message to reply to"
                        },
                        "attachments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "file_id": {"type": "string"},
                                    "filename": {"type": "string"},
                                    "mime_type": {"type": "string"}
                                }
                            },
                            "description": "Optional file attachments"
                        }
                    },
                    "required": ["project_id", "content"],
                    "additionalProperties": False
                },
                func=self.send_project_message
            ),
            
            # Global State Management
            AgentTool(
                name="set_project_global_state",
                description="Set a global state value for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key"
                        },
                        "value": {
                            "description": "State value (any type)"
                        }
                    },
                    "required": ["project_id", "key", "value"],
                    "additionalProperties": False
                },
                func=self.set_project_global_state
            ),
            
            AgentTool(
                name="get_project_global_state",
                description="Get a global state value for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key to retrieve"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.get_project_global_state
            ),
            
            AgentTool(
                name="list_project_global_state",
                description="List all global state for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string", 
                            "description": "ID of the project"
                        }
                    },
                    "required": ["project_id"],
                    "additionalProperties": False
                },
                func=self.list_project_global_state
            ),
            
            AgentTool(
                name="delete_project_global_state",
                description="Delete a global state value for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key to delete"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.delete_project_global_state
            ),
            
            # Agent State Management
            AgentTool(
                name="set_project_agent_state",
                description="Set your agent-specific state for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key"
                        },
                        "value": {
                            "description": "State value (any type)"
                        }
                    },
                    "required": ["project_id", "key", "value"],
                    "additionalProperties": False
                },
                func=self.set_project_agent_state
            ),
            
            AgentTool(
                name="get_project_agent_state",
                description="Get your agent-specific state for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key to retrieve"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.get_project_agent_state
            ),
            
            AgentTool(
                name="list_project_agent_state",
                description="List all your agent-specific state for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        }
                    },
                    "required": ["project_id"],
                    "additionalProperties": False
                },
                func=self.list_project_agent_state
            ),
            
            AgentTool(
                name="delete_project_agent_state",
                description="Delete your agent-specific state for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "State key to delete"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.delete_project_agent_state
            ),
            
            # Artifact Management
            AgentTool(
                name="set_project_artifact",
                description="Set a project artifact (document, file, etc.)",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "Artifact key/name"
                        },
                        "value": {
                            "type": "string",
                            "description": "Artifact content"
                        }
                    },
                    "required": ["project_id", "key", "value"],
                    "additionalProperties": False
                },
                func=self.set_project_artifact
            ),
            
            AgentTool(
                name="get_project_artifact",
                description="Get a project artifact",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "Artifact key/name to retrieve"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.get_project_artifact
            ),
            
            AgentTool(
                name="list_project_artifacts",
                description="List all artifact keys for the project",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        }
                    },
                    "required": ["project_id"],
                    "additionalProperties": False
                },
                func=self.list_project_artifacts
            ),
            
            AgentTool(
                name="delete_project_artifact",
                description="Delete a project artifact",
                input_schema={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project"
                        },
                        "key": {
                            "type": "string",
                            "description": "Artifact key/name to delete"
                        }
                    },
                    "required": ["project_id", "key"],
                    "additionalProperties": False
                },
                func=self.delete_project_artifact
            )
        ]

        # Add template-specific tools if mod is bound and has templates
        if self._mod:
            has_templates_attr = hasattr(self._mod, 'templates')
            templates_dict = getattr(self._mod, 'templates', {})
            templates_count = len(templates_dict) if templates_dict else 0
            logger.info(f"Project adapter: mod bound, has_templates={has_templates_attr}, templates_count={templates_count}")

            if templates_dict:
                # Log template details
                for tid, template in templates_dict.items():
                    expose = getattr(template, 'expose_as_tool', False)
                    mode = getattr(template, 'tool_mode', 'sync')
                    logger.info(f"  Template '{tid}': expose_as_tool={expose}, tool_mode={mode}")

                template_tools = generate_template_tools(
                    templates=templates_dict,
                    start_project_handler=self._start_project_from_template,
                    get_project_handler=self.get_project
                )
                tools.extend(template_tools)
                logger.info(f"Added {len(template_tools)} template tools from {templates_count} templates")
        else:
            logger.warning(f"Project adapter: mod NOT bound - no template tools will be generated")

        return tools

    # Template Management

    async def list_project_templates(self) -> Dict[str, Any]:
        """List all available project templates."""
        message = ProjectTemplateListMessage(source_id=self._agent_id)
        return await self._send_and_wait_for_response(message)

    # Project Lifecycle

    async def start_project(
        self,
        template_id: str,
        goal: str,
        name: Optional[str] = None,
        collaborators: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Start a new project from a template."""
        message = ProjectStartMessage(
            template_id=template_id,
            goal=goal,
            source_id=self._agent_id,
            name=name,
            collaborators=collaborators
        )
        return await self._send_and_wait_for_response(message)

    async def _start_project_from_template(
        self,
        template_id: str,
        goal: str,
        name: Optional[str] = None,
        collaborators: Optional[List[str]] = None,
        custom_params: Optional[Dict[str, Any]] = None,
        wait_for_completion: bool = True,
        timeout: float = 300.0,
        poll_interval: float = 2.0
    ) -> Dict[str, Any]:
        """Start a project from a template with custom parameters.

        This is called by template-specific tools to start projects
        with additional custom parameters defined in the template's input schema.

        When called via MCP (external tools), this method will wait for the project
        to complete and return the final results including all messages.

        Args:
            template_id: The template to use
            goal: The project goal
            name: Optional project name
            collaborators: Optional list of collaborator agent IDs
            custom_params: Additional custom parameters from the template tool
            wait_for_completion: Whether to wait for project completion (default: True)
            timeout: Maximum time to wait for completion in seconds (default: 300s / 5 min)
            poll_interval: Time between status checks in seconds (default: 2s)

        Returns:
            The project data with final results if wait_for_completion is True,
            otherwise just the project creation response
        """
        # Enhance goal with custom params if provided
        enhanced_goal = goal
        if custom_params:
            param_lines = [f"- {k}: {v}" for k, v in custom_params.items()]
            param_str = "\n".join(param_lines)
            enhanced_goal = f"{goal}\n\nAdditional Parameters:\n{param_str}"

        # Start the project
        start_response = await self.start_project(
            template_id=template_id,
            goal=enhanced_goal,
            name=name,
            collaborators=collaborators
        )

        # If start failed or not waiting for completion, return immediately
        if not start_response.get("success") or not wait_for_completion:
            return start_response

        project_id = start_response.get("data", {}).get("project_id")
        if not project_id:
            return start_response

        # Poll for project completion
        terminal_statuses = {"completed", "failed", "stopped"}
        elapsed = 0.0

        logger.info(f"Waiting for project {project_id} to complete (timeout: {timeout}s)")

        while elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

            # Check project status
            project_response = await self.get_project(project_id)
            if not project_response.get("success"):
                logger.warning(f"Failed to get project status: {project_response.get('message')}")
                continue

            project_data = project_response.get("data", {}).get("project", {})
            status = project_data.get("status", "")

            if status in terminal_statuses:
                logger.info(f"Project {project_id} reached terminal status: {status}")

                # Extract the final result from messages or artifacts
                messages = project_data.get("messages", [])
                artifacts = project_data.get("artifacts", {})

                # Build the final result
                result = {
                    "success": True,
                    "message": f"Project {status}",
                    "data": {
                        "project_id": project_id,
                        "status": status,
                        "goal": project_data.get("goal"),
                        "summary": project_data.get("summary"),
                        "messages": messages,
                        "artifacts": artifacts,
                        # Include the last message content as the primary result
                        "result": self._extract_final_result(messages, artifacts)
                    }
                }
                return result

        # Timeout reached
        logger.warning(f"Project {project_id} did not complete within {timeout}s timeout")
        return {
            "success": False,
            "message": f"Project did not complete within {timeout}s timeout",
            "data": {
                "project_id": project_id,
                "status": "timeout"
            }
        }

    def _extract_final_result(self, messages: List[Dict[str, Any]], artifacts: Dict[str, Any]) -> str:
        """Extract the final result from project messages or artifacts.

        Looks for the final comparison/result message from the project workflow.

        Args:
            messages: List of project messages
            artifacts: Dictionary of project artifacts

        Returns:
            The final result text
        """
        # First, check for a 'final_result' or 'comparison' artifact
        for key in ["final_result", "comparison", "result", "output"]:
            if key in artifacts:
                return artifacts[key]

        # Otherwise, look for the last substantive message
        # Skip system messages and look for content from agents
        for msg in reversed(messages):
            content = msg.get("content", {})
            text = content.get("text", "")
            sender = msg.get("sender_id", "")

            # Skip messages from mcp_client (the caller) or system
            if sender in ["mcp_client", "system", "mod:openagents.mods.workspace.project"]:
                continue

            # Return the first non-trivial message found
            if text and len(text) > 50:  # Skip very short messages
                return text

        # Fallback: return the last message if any
        if messages:
            last_msg = messages[-1]
            content = last_msg.get("content", {})
            return content.get("text", "No result available")

        return "No result available"

    async def stop_project(self, project_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """Stop a project."""
        message = ProjectStopMessage(
            project_id=project_id,
            source_id=self._agent_id,
            reason=reason
        )
        return await self._send_and_wait_for_response(message)

    async def complete_project(self, project_id: str, summary: str) -> Dict[str, Any]:
        """Complete a project."""
        message = ProjectCompleteMessage(
            project_id=project_id,
            summary=summary,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def get_project(self, project_id: str) -> Dict[str, Any]:
        """Get project details."""
        message = ProjectGetMessage(
            project_id=project_id,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    # Project Messaging

    async def send_project_message(
        self,
        project_id: str,
        content: Dict[str, Any],
        reply_to_id: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Send a message to the project channel."""
        message = ProjectMessageSendMessage(
            project_id=project_id,
            content=content,
            source_id=self._agent_id,
            reply_to_id=reply_to_id,
            attachments=attachments
        )
        return await self._send_and_wait_for_response(message)

    # Global State Management

    async def set_project_global_state(self, project_id: str, key: str, value: Any) -> Dict[str, Any]:
        """Set a global state value for the project."""
        message = ProjectGlobalStateSetMessage(
            project_id=project_id,
            key=key,
            value=value,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def get_project_global_state(self, project_id: str, key: str) -> Dict[str, Any]:
        """Get a global state value for the project."""
        message = ProjectGlobalStateGetMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def list_project_global_state(self, project_id: str) -> Dict[str, Any]:
        """List all global state for the project."""
        message = ProjectGlobalStateListMessage(
            project_id=project_id,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def delete_project_global_state(self, project_id: str, key: str) -> Dict[str, Any]:
        """Delete a global state value for the project."""
        message = ProjectGlobalStateDeleteMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    # Agent State Management

    async def set_project_agent_state(self, project_id: str, key: str, value: Any) -> Dict[str, Any]:
        """Set your agent-specific state for the project."""
        message = ProjectAgentStateSetMessage(
            project_id=project_id,
            key=key,
            value=value,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def get_project_agent_state(self, project_id: str, key: str) -> Dict[str, Any]:
        """Get your agent-specific state for the project."""
        message = ProjectAgentStateGetMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def list_project_agent_state(self, project_id: str) -> Dict[str, Any]:
        """List all your agent-specific state for the project."""
        message = ProjectAgentStateListMessage(
            project_id=project_id,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def delete_project_agent_state(self, project_id: str, key: str) -> Dict[str, Any]:
        """Delete your agent-specific state for the project."""
        message = ProjectAgentStateDeleteMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    # Artifact Management

    async def set_project_artifact(self, project_id: str, key: str, value: str) -> Dict[str, Any]:
        """Set a project artifact."""
        message = ProjectArtifactSetMessage(
            project_id=project_id,
            key=key,
            value=value,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def get_project_artifact(self, project_id: str, key: str) -> Dict[str, Any]:
        """Get a project artifact."""
        message = ProjectArtifactGetMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def list_project_artifacts(self, project_id: str) -> Dict[str, Any]:
        """List all artifact keys for the project."""
        message = ProjectArtifactListMessage(
            project_id=project_id,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    async def delete_project_artifact(self, project_id: str, key: str) -> Dict[str, Any]:
        """Delete a project artifact."""
        message = ProjectArtifactDeleteMessage(
            project_id=project_id,
            key=key,
            source_id=self._agent_id
        )
        return await self._send_and_wait_for_response(message)

    # Utility Methods

    async def _send_and_wait_for_response(self, message, timeout: float = 10.0) -> Dict[str, Any]:
        """Send a message and get direct response."""
        # Send message via event system
        # Get all message fields using model_dump()
        message_data = message.model_dump()

        # Remove fields that shouldn't be in the payload
        payload = {
            key: value for key, value in message_data.items()
            if key not in ['event_name', 'source_id', 'event_id', 'timestamp', 'payload', 'metadata']
        }

        # Rename message_content to content for backward compatibility with mod handlers
        # The field is named message_content in the model to avoid shadowing Event.content property
        if 'message_content' in payload:
            payload['content'] = payload.pop('message_content')

        event = Event(
            event_name=message.event_name,
            source_id=self._agent_id,
            relevant_mod="openagents.mods.workspace.project",
            payload=payload
        )

        try:
            response = await self._connector.send_event(event)

            # Convert EventResponse to dict format
            return {
                "success": response.success,
                "message": response.message,
                "data": response.data
            }

        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return {"success": False, "error": str(e)}

    async def handle_message(self, message) -> None:
        """Handle incoming messages."""
        if isinstance(message, Event):
            # Handle project notifications
            if message.event_name.startswith("project.notification."):
                await self._handle_project_notification(message)

    async def _handle_project_notification(self, message: Event) -> None:
        """Handle project notifications."""
        event_name = message.event_name
        payload = message.payload or {}

        logger.info(f"Received project notification: {event_name}")

        # Agents can override this method to handle specific notifications
        # For now, just log the notification
        if event_name == "project.notification.started":
            project_id = payload.get("project_id")
            logger.info(f"Project {project_id} was started")
        elif event_name == "project.notification.completed":
            project_id = payload.get("project_id")
            summary = payload.get("summary")
            logger.info(f"Project {project_id} was completed: {summary}")
        elif event_name == "project.notification.message_received":
            project_id = payload.get("project_id")
            sender_id = payload.get("sender_id")
            logger.info(f"New message in project {project_id} from {sender_id}")
        elif event_name == "project.notification.artifact_updated":
            project_id = payload.get("project_id")
            key = payload.get("key")
            action = payload.get("action")
            logger.info(f"Artifact '{key}' was {action} in project {project_id}")