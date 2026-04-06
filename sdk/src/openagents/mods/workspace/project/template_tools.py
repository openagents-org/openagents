"""
Template tools generator for the Project mod.

This module provides utilities to generate AgentTool instances from ProjectTemplates
that have expose_as_tool enabled. Each template becomes a standalone tool with
its own customizable input schema.
"""

from typing import Any, Callable, Dict, List, Optional
import copy

from openagents.models.tool import AgentTool
from openagents.workspace.project import ProjectTemplate


DEFAULT_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "task": {
            "type": "string",
            "description": "The project task or objective"
        },
        "name": {
            "type": "string",
            "description": "Optional project name"
        },
        "collaborators": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of additional agent IDs to collaborate"
        }
    },
    "required": ["task"]
}


def generate_template_tool_name(template_id: str, custom_name: Optional[str] = None) -> str:
    """
    Generate tool name from template ID.

    Args:
        template_id: The template identifier
        custom_name: Optional custom name to use instead

    Returns:
        The tool name (custom_name if provided, otherwise start_{template_id}_project)
    """
    if custom_name:
        return custom_name
    # Convert template_id to snake_case tool name
    return f"start_{template_id}_project"


def generate_template_tool_description(template: ProjectTemplate) -> str:
    """
    Generate tool description from template.

    Args:
        template: The project template

    Returns:
        The tool description (custom if provided, otherwise derived from template)
    """
    if template.tool_description:
        return template.tool_description

    base_desc = f"Start a new '{template.name}' project."
    if template.description:
        return f"{base_desc} {template.description}"
    return base_desc


def merge_input_schemas(
    base_schema: Dict[str, Any],
    custom_schema: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Merge custom schema with base schema, custom takes precedence.

    Args:
        base_schema: The default input schema
        custom_schema: Optional custom schema to merge

    Returns:
        The merged schema
    """
    if not custom_schema:
        return copy.deepcopy(base_schema)

    # Start with custom schema as base
    merged = copy.deepcopy(custom_schema)

    # Ensure type is set
    if "type" not in merged:
        merged["type"] = "object"

    # Ensure properties exist
    if "properties" not in merged:
        merged["properties"] = {}

    # Ensure task property exists (it's always required)
    if "task" not in merged["properties"]:
        merged["properties"]["task"] = {
            "type": "string",
            "description": "The project task or objective"
        }

    # Always require 'task' at minimum
    if "required" not in merged:
        merged["required"] = ["task"]
    elif "task" not in merged["required"]:
        merged["required"] = list(merged["required"])
        merged["required"].append("task")

    return merged


def create_template_tool(
    template: ProjectTemplate,
    start_project_handler: Callable[..., Any]
) -> AgentTool:
    """
    Create an AgentTool from a ProjectTemplate.

    Args:
        template: The project template to create a tool for
        start_project_handler: Async callable that handles project creation

    Returns:
        An AgentTool instance configured for this template
    """
    tool_name = generate_template_tool_name(template.template_id, template.tool_name)
    tool_description = generate_template_tool_description(template)
    input_schema = merge_input_schemas(DEFAULT_INPUT_SCHEMA, template.input_schema)

    # Capture template_id in closure
    captured_template_id = template.template_id

    async def tool_func(**kwargs: Any) -> Dict[str, Any]:
        """Execute template-specific project start."""
        # Extract standard parameters
        task = kwargs.get("task")
        name = kwargs.get("name") or kwargs.get("project_name")
        collaborators = kwargs.get("collaborators", [])

        # Store custom parameters in project metadata/context
        standard_params = {"task", "name", "project_name", "collaborators"}
        custom_params = {k: v for k, v in kwargs.items() if k not in standard_params}

        return await start_project_handler(
            template_id=captured_template_id,
            goal=task,
            name=name,
            collaborators=collaborators,
            custom_params=custom_params
        )

    return AgentTool(
        name=tool_name,
        description=tool_description,
        input_schema=input_schema,
        func=tool_func
    )


def create_async_template_tools(
    template: ProjectTemplate,
    start_project_handler: Callable[..., Any],
    get_project_handler: Callable[..., Any]
) -> List[AgentTool]:
    """
    Create async tools (start + get_result) from a ProjectTemplate.

    For templates with tool_mode="async", this generates two tools:
    1. Start tool - starts the project, returns project_id immediately
    2. Get result tool - retrieves current status/result for a project_id

    Args:
        template: The project template to create tools for
        start_project_handler: Async callable that handles project creation
        get_project_handler: Async callable that retrieves project status/result

    Returns:
        List of two AgentTool instances [start_tool, get_result_tool]
    """
    tool_name = generate_template_tool_name(template.template_id, template.tool_name)
    base_description = template.tool_description or template.description or f"Start a new '{template.name}' project"
    input_schema = merge_input_schemas(DEFAULT_INPUT_SCHEMA, template.input_schema)

    # Capture template_id in closure
    captured_template_id = template.template_id
    captured_tool_name = tool_name

    # Tool 1: Start tool - returns immediately with project_id
    async def start_func(**kwargs: Any) -> Dict[str, Any]:
        """Start project and return project_id immediately."""
        task = kwargs.get("task")
        name = kwargs.get("name") or kwargs.get("project_name")
        collaborators = kwargs.get("collaborators", [])

        standard_params = {"task", "name", "project_name", "collaborators"}
        custom_params = {k: v for k, v in kwargs.items() if k not in standard_params}

        # Call with wait_for_completion=False for async mode
        return await start_project_handler(
            template_id=captured_template_id,
            goal=task,
            name=name,
            collaborators=collaborators,
            custom_params=custom_params,
            wait_for_completion=False
        )

    start_tool = AgentTool(
        name=f"start_{tool_name}",
        description=f"{base_description}. Returns project_id immediately - use get_result_{tool_name} to check status and retrieve results.",
        input_schema=input_schema,
        func=start_func
    )

    # Tool 2: Get result tool - returns current status immediately
    get_result_schema = {
        "type": "object",
        "properties": {
            "project_id": {
                "type": "string",
                "description": f"Project ID returned by start_{tool_name}"
            }
        },
        "required": ["project_id"]
    }

    async def get_result_func(**kwargs: Any) -> Dict[str, Any]:
        """Get current project status and result."""
        project_id = kwargs.get("project_id")
        if not project_id:
            return {
                "success": False,
                "message": "project_id is required",
                "data": {}
            }

        # Get project data
        response = await get_project_handler(project_id=project_id)
        if not response.get("success"):
            return response

        project_data = response.get("data", {}).get("project", {})
        status = project_data.get("status", "unknown")
        messages = project_data.get("messages", [])
        artifacts = project_data.get("artifacts", {})

        # Build result based on status
        result_data = {
            "project_id": project_id,
            "status": status,
        }

        # Only include result data if project is in a terminal state
        if status in ("completed", "failed", "stopped"):
            result_data["result"] = _extract_result_from_messages(messages, artifacts)
            result_data["messages"] = messages
            result_data["artifacts"] = artifacts

        return {
            "success": True,
            "message": f"Project status: {status}",
            "data": result_data
        }

    get_result_tool = AgentTool(
        name=f"get_result_{tool_name}",
        description=f"Get the current status and result of a {template.name} project. Returns immediately with current state - call again if status is 'running'.",
        input_schema=get_result_schema,
        func=get_result_func
    )

    return [start_tool, get_result_tool]


def _extract_result_from_messages(messages: List[Dict[str, Any]], artifacts: Dict[str, Any]) -> str:
    """
    Extract the final result from project messages or artifacts.

    Args:
        messages: List of project messages
        artifacts: Dictionary of project artifacts

    Returns:
        The final result text
    """
    # First, check for result artifacts
    for key in ["final_result", "comparison", "result", "output"]:
        if key in artifacts:
            return artifacts[key]

    # Look for the last substantive message from agents
    for msg in reversed(messages):
        content = msg.get("content", {})
        text = content.get("text", "")
        sender = msg.get("sender_id", "")

        # Skip messages from mcp_client or system
        if sender in ["mcp_client", "system", "mod:openagents.mods.workspace.project"]:
            continue

        # Return first non-trivial message found
        if text and len(text) > 50:
            return text

    # Fallback: return last message if any
    if messages:
        last_msg = messages[-1]
        content = last_msg.get("content", {})
        return content.get("text", "No result available")

    return "No result available"


def generate_template_tools(
    templates: Dict[str, ProjectTemplate],
    start_project_handler: Callable[..., Any],
    get_project_handler: Optional[Callable[..., Any]] = None
) -> List[AgentTool]:
    """
    Generate tools for all templates with expose_as_tool=True.

    Args:
        templates: Dictionary of template_id -> ProjectTemplate
        start_project_handler: Async callable that handles project creation
        get_project_handler: Async callable that retrieves project status (required for async mode)

    Returns:
        List of AgentTool instances for exposed templates
    """
    tools: List[AgentTool] = []

    for template_id, template in templates.items():
        if template.expose_as_tool:
            if template.tool_mode == "async":
                if get_project_handler is None:
                    raise ValueError(
                        f"Template '{template_id}' has tool_mode='async' but no get_project_handler provided"
                    )
                async_tools = create_async_template_tools(
                    template, start_project_handler, get_project_handler
                )
                tools.extend(async_tools)
            else:
                # Default sync mode
                tool = create_template_tool(template, start_project_handler)
                tools.append(tool)

    return tools


def validate_template_tool_names(templates: Dict[str, ProjectTemplate]) -> List[str]:
    """
    Validate that all template tool names are unique.

    Args:
        templates: Dictionary of template_id -> ProjectTemplate

    Returns:
        List of error messages (empty if all names are unique)
    """
    errors: List[str] = []
    seen_names: Dict[str, str] = {}  # tool_name -> template_id

    for template_id, template in templates.items():
        if not template.expose_as_tool:
            continue

        tool_name = generate_template_tool_name(template.template_id, template.tool_name)

        if tool_name in seen_names:
            errors.append(
                f"Duplicate tool name '{tool_name}' found in templates "
                f"'{seen_names[tool_name]}' and '{template_id}'"
            )
        else:
            seen_names[tool_name] = template_id

    return errors
