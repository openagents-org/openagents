"""
AutoGen Agent Runner for OpenAgents.

This module provides a wrapper that allows AutoGen agents and teams to connect
to and participate in the OpenAgents network.
"""

import asyncio
import inspect
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Set

from pydantic import BaseModel, ConfigDict, Field, create_model
from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type alias for AutoGen entities - use Any to avoid hard dependency.
AutoGenEntity = Any


def _sanitize_identifier(name: str) -> str:
    """Convert schema keys into safe Python identifiers."""
    sanitized = re.sub(r"\W+", "_", name).strip("_")
    if not sanitized:
        sanitized = "field"
    if sanitized[0].isdigit():
        sanitized = f"field_{sanitized}"
    return sanitized


def _build_model_name(tool_name: str) -> str:
    """Build a stable Pydantic model name for a tool schema."""
    parts = re.split(r"[^a-zA-Z0-9]+", tool_name)
    name = "".join(part.capitalize() for part in parts if part)
    return f"{name or 'OpenAgents'}Args"


def _schema_to_annotation(schema: Any) -> Any:
    """Map a JSON-schema-like field definition to a Python annotation."""
    if not isinstance(schema, dict):
        return Any

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null_types = [item for item in schema_type if item != "null"]
        if len(non_null_types) == 1:
            nested_schema = dict(schema)
            nested_schema["type"] = non_null_types[0]
            return Optional[_schema_to_annotation(nested_schema)]
        return Any

    primitive_types = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
    }
    if schema_type in primitive_types:
        return primitive_types[schema_type]

    if schema_type == "array":
        item_annotation = _schema_to_annotation(schema.get("items", {}))
        return List[item_annotation]

    if schema_type == "object":
        return Dict[str, Any]

    return Any


def _build_args_model(agent_tool: AgentTool) -> type[BaseModel]:
    """Build a Pydantic args model from an OpenAgents tool schema."""
    input_schema = agent_tool.input_schema or {}
    properties = input_schema.get("properties", {})
    required_fields = set(input_schema.get("required", []))
    field_definitions: Dict[str, tuple[Any, Any]] = {}

    if not isinstance(properties, dict):
        properties = {}

    for original_name, field_schema in properties.items():
        internal_name = _sanitize_identifier(original_name)
        if internal_name in field_definitions:
            suffix = 2
            while f"{internal_name}_{suffix}" in field_definitions:
                suffix += 1
            internal_name = f"{internal_name}_{suffix}"

        annotation = _schema_to_annotation(field_schema)
        description = ""
        if isinstance(field_schema, dict):
            description = field_schema.get("description", "") or ""

        default_value = ... if original_name in required_fields else None
        field_definitions[internal_name] = (
            annotation,
            Field(
                default=default_value,
                alias=original_name,
                description=description,
            ),
        )

    return create_model(
        _build_model_name(agent_tool.name),
        __config__=ConfigDict(populate_by_name=True),
        **field_definitions,
    )


def openagents_tool_to_autogen(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to an AutoGen FunctionTool.

    Args:
        agent_tool: The OpenAgents tool to convert.

    Returns:
        An AutoGen FunctionTool instance.

    Raises:
        ImportError: If AutoGen packages are not installed.
    """
    try:
        from autogen_core.tools import BaseTool
    except ImportError:
        raise ImportError(
            "autogen-core is required for tool conversion. "
            "Install it with: pip install autogen-core"
        )

    args_model = _build_args_model(agent_tool)

    class OpenAgentsAutoGenTool(BaseTool[BaseModel, Any]):
        """Adapter that preserves schema for AutoGen tool calling."""

        def __init__(self):
            super().__init__(
                args_type=args_model,
                return_type=object,
                name=agent_tool.name,
                description=agent_tool.description or "",
                strict=False,
            )
            self._openagents_tool = agent_tool

        async def run(self, args: BaseModel, cancellation_token: Any) -> Any:
            del cancellation_token
            kwargs = args.model_dump(by_alias=True, exclude_none=True)
            return await self._openagents_tool.execute(**kwargs)

    return OpenAgentsAutoGenTool()


def autogen_tool_to_openagents(autogen_tool: Any) -> AgentTool:
    """
    Convert an AutoGen tool to an OpenAgents AgentTool.

    Args:
        autogen_tool: The AutoGen tool to convert.

    Returns:
        An OpenAgents AgentTool instance.
    """
    name = getattr(autogen_tool, "name", autogen_tool.__class__.__name__)
    description = getattr(autogen_tool, "description", "") or ""
    input_schema = {}

    if hasattr(autogen_tool, "schema"):
        schema_value = getattr(autogen_tool, "schema")
        if isinstance(schema_value, dict):
            description = (
                schema_value.get("description", description) or description
            )
            parameters = schema_value.get("parameters")
            if isinstance(parameters, dict):
                input_schema = parameters
            else:
                input_schema = schema_value
    elif hasattr(autogen_tool, "input_schema"):
        schema_value = getattr(autogen_tool, "input_schema")
        if isinstance(schema_value, dict):
            input_schema = schema_value

    async def tool_func(**kwargs) -> Any:
        if hasattr(autogen_tool, "run_json"):
            try:
                from autogen_core import CancellationToken

                result = autogen_tool.run_json(kwargs, CancellationToken())
            except ImportError:
                result = autogen_tool.run_json(kwargs)
            if inspect.isawaitable(result):
                return await result
            return result
        if hasattr(autogen_tool, "run"):
            try:
                from autogen_core import CancellationToken

                cancellation_token = CancellationToken()
            except ImportError:
                cancellation_token = None

            if (
                hasattr(autogen_tool, "args_type")
                and callable(autogen_tool.args_type)
            ):
                args = autogen_tool.args_type(**kwargs)
                result = autogen_tool.run(args, cancellation_token)
            else:
                result = autogen_tool.run(kwargs)
            if inspect.isawaitable(result):
                return await result
            return result
        if callable(autogen_tool):
            result = autogen_tool(**kwargs)
            if inspect.isawaitable(result):
                return await result
            return result
        raise ValueError(f"Tool {name} has no callable execution method")

    return AgentTool(
        name=name,
        description=description,
        input_schema=input_schema,
        func=tool_func,
    )


class AutoGenAgentRunner(AgentRunner):
    """
    AgentRunner wrapper for AutoGen 0.7.5 entities (single agent or team).
    """

    def __init__(
        self,
        autogen_entity: AutoGenEntity,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        response_handler: Optional[Callable[[EventContext, str], None]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        **kwargs,
    ):
        super().__init__(agent_id=agent_id, **kwargs)

        self._autogen_entity = autogen_entity
        self._include_network_tools = include_network_tools
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = (
            set(event_names) if event_names else None
        )
        self._event_filter = event_filter
        self._tools_injected = False

        if not (
            hasattr(autogen_entity, "run")
            or hasattr(autogen_entity, "run_stream")
        ):
            raise ValueError(
                "autogen_entity must provide a run-like API "
                "(run/run_stream)."
            )

        logger.info(
            "Initialized AutoGenAgentRunner with agent_id=%s",
            agent_id,
        )

    @property
    def autogen_entity(self) -> AutoGenEntity:
        """Get the wrapped AutoGen entity."""
        return self._autogen_entity

    def _should_react(self, context: EventContext) -> bool:
        event = context.incoming_event

        if (
            self._event_names is not None
            and event.event_name not in self._event_names
        ):
            logger.debug(
                "Skipping event '%s' - not in allowed event_names: %s",
                event.event_name,
                self._event_names,
            )
            return False

        if self._event_filter is not None:
            try:
                if not self._event_filter(context):
                    logger.debug(
                        "Skipping event '%s' - rejected by custom "
                        "event_filter",
                        event.event_name,
                    )
                    return False
            except Exception as error:
                logger.error("Error in event_filter: %s", error)
                return False

        return True

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()
        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """Inject OpenAgents tools into supported AutoGen tool containers."""
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            autogen_tools = [
                openagents_tool_to_autogen(tool) for tool in openagents_tools
            ]
        except ImportError as error:
            logger.warning("Could not inject network tools: %s", error)
            return
        except Exception as error:
            logger.error("Error converting tools for AutoGen: %s", error)
            return

        targets = self._collect_tool_targets(self._autogen_entity)
        injected = 0

        for target in targets:
            for autogen_tool in autogen_tools:
                if self._attach_tool(target, autogen_tool):
                    injected += 1

        if injected == 0:
            logger.warning(
                "Runtime tool injection is only supported for AutoGen "
                "entities that expose mutable 'tools' or '_tools' lists. "
                "Otherwise, preconfigure tools at construction time. "
                "Network tools not injected."
            )
            return

        logger.info(
            "Injected %s OpenAgents tools into %s AutoGen target(s)",
            len(autogen_tools),
            len(targets),
        )

    def _collect_tool_targets(self, entity: Any) -> List[Any]:
        """Collect potential tool-registration targets from entity."""
        targets = [entity]

        for attr_name in ("participants", "agents"):
            if hasattr(entity, attr_name):
                value = getattr(entity, attr_name)
                if isinstance(value, list):
                    targets.extend(value)

        # Preserve order and drop duplicates by object identity.
        seen = set()
        unique_targets = []
        for target in targets:
            target_id = id(target)
            if target_id not in seen:
                seen.add(target_id)
                unique_targets.append(target)

        return unique_targets

    def _attach_tool(self, target: Any, autogen_tool: Any) -> bool:
        """Attach an AutoGen tool only through mutable tool containers."""
        if hasattr(target, "tools") and isinstance(target.tools, list):
            target.tools.append(autogen_tool)
            return True

        if hasattr(target, "_tools") and isinstance(target._tools, list):
            target._tools.append(autogen_tool)
            return True

        return False

    def _extract_input_text(self, context: EventContext) -> str:
        """Extract input text from OpenAgents event context."""
        event = context.incoming_event

        if hasattr(event, "text_representation") and event.text_representation:
            return event.text_representation

        if isinstance(event.payload, dict):
            content = event.payload.get("content", {})
            if isinstance(content, dict) and "text" in content:
                return str(content["text"])
            if "text" in event.payload:
                return str(event.payload["text"])
            if "message" in event.payload:
                return str(event.payload["message"])

        if event.payload:
            return str(event.payload)

        return ""

    def _extract_output(self, result: Any) -> str:
        """Extract textual output from AutoGen result objects."""
        if result is None:
            return ""

        if isinstance(result, str):
            return result

        if isinstance(result, dict):
            for key in ("output", "content", "summary", "message", "text"):
                if key in result:
                    return str(result[key])
            return str(result)

        # AutoGen task results often expose messages list.
        if self._has_explicit_attr(result, "messages"):
            messages = getattr(result, "messages")
            if isinstance(messages, (list, tuple)) and messages:
                last_message = messages[-1]
                return self._extract_message_text(last_message)

        for attr_name in ("summary", "output", "content", "text", "data"):
            if self._has_explicit_attr(result, attr_name):
                value = getattr(result, attr_name, None)
                if value is not None:
                    return str(value)

        return str(result)

    def _extract_message_text(self, message: Any) -> str:
        """Extract text from a message-like object."""
        if isinstance(message, str):
            return message
        if isinstance(message, dict):
            for key in ("content", "text", "message"):
                if key in message:
                    return str(message[key])
            return str(message)
        for attr_name in ("content", "text", "message"):
            if hasattr(message, attr_name):
                value = getattr(message, attr_name)
                if value is not None:
                    return str(value)
        return str(message)

    def _has_explicit_attr(self, obj: Any, attr_name: str) -> bool:
        """Check whether an attribute is explicitly defined on an object."""
        if hasattr(obj, "__dict__") and attr_name in obj.__dict__:
            return True

        return hasattr(type(obj), attr_name)

    async def _consume_stream(self, stream: Any) -> Any:
        """Consume an AutoGen async stream and return the terminal item."""
        last_item = None
        async for item in stream:
            last_item = item
        return last_item

    async def _invoke_autogen(
        self,
        input_text: str,
        context: EventContext,
    ) -> Any:
        """Invoke wrapped AutoGen entity across common API shapes."""
        attempts = [
            ("run", (), {"task": input_text}),
            ("run", (input_text,), {}),
            ("run_stream", (), {"task": input_text}),
            ("run_stream", (input_text,), {}),
        ]

        last_type_error: Optional[TypeError] = None
        for method_name, args, kwargs in attempts:
            if not hasattr(self._autogen_entity, method_name):
                continue

            method = getattr(self._autogen_entity, method_name)
            try:
                return await self._call_method(method, *args, **kwargs)
            except TypeError as error:
                last_type_error = error
                continue

        if last_type_error:
            raise ValueError(
                f"AutoGen entity run signature is incompatible: "
                f"{last_type_error}"
            )
        raise ValueError(
            "AutoGen entity does not provide a compatible run API"
        )

    async def _call_method(self, method: Callable, *args, **kwargs) -> Any:
        """Call sync or async method in a safe way."""
        if inspect.isasyncgenfunction(method):
            return await self._consume_stream(method(*args, **kwargs))

        if inspect.iscoroutinefunction(method):
            result = await method(*args, **kwargs)
        else:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: method(*args, **kwargs),
            )

        if inspect.isasyncgen(result):
            return await self._consume_stream(result)

        return result

    async def react(self, context: EventContext):
        """React to incoming event using wrapped AutoGen entity."""
        if not self._should_react(context):
            return

        try:
            input_text = self._extract_input_text(context)
            logger.debug(
                "Running AutoGen entity with input: %s...",
                input_text[:100],
            )

            result = await self._invoke_autogen(input_text, context)
            output_text = self._extract_output(result)
            logger.debug(
                "AutoGen entity response: %s...",
                output_text[:100],
            )

            await self._send_response(context, output_text)
        except Exception as error:
            logger.error("Error in AutoGen entity execution: %s", error)
            await self._send_response(
                context,
                f"I encountered an error: {error}",
            )

    async def _send_response(self, context: EventContext, response_text: str):
        """Send the generated response to the network."""
        if self._response_handler:
            await self._response_handler(context, response_text)
            return

        source_id = context.incoming_event.source_id
        if not source_id:
            logger.warning("No source_id in event, cannot send response")
            return

        response_event = Event(
            event_name="agent.message",
            source_id=self.agent_id,
            destination_id=source_id,
            payload={
                "content": {"text": response_text},
                "response_to": context.incoming_event.event_id,
            },
        )

        await self.send_event(response_event)
        logger.debug("Sent response to %s", source_id)


def create_autogen_runner(
    autogen_entity: AutoGenEntity,
    agent_id: Optional[str] = None,
    **kwargs,
) -> AutoGenAgentRunner:
    """
    Convenience function to create an AutoGenAgentRunner.
    """
    return AutoGenAgentRunner(
        autogen_entity=autogen_entity,
        agent_id=agent_id,
        **kwargs,
    )
