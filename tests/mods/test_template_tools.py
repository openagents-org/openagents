"""
Test template tools functionality for project templates exposed as tools.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from openagents.workspace.project import ProjectTemplate
from openagents.mods.workspace.project.template_tools import (
    generate_template_tool_name,
    generate_template_tool_description,
    merge_input_schemas,
    create_template_tool,
    generate_template_tools,
    validate_template_tool_names,
    DEFAULT_INPUT_SCHEMA
)


class TestGenerateTemplateToolName:
    """Tests for generate_template_tool_name function."""

    def test_default_name_generation(self):
        """Test default tool name generation from template_id."""
        result = generate_template_tool_name("software_dev")
        assert result == "start_software_dev_project"

    def test_custom_name_takes_precedence(self):
        """Test that custom name overrides default generation."""
        result = generate_template_tool_name("software_dev", "create_app")
        assert result == "create_app"

    def test_none_custom_name_uses_default(self):
        """Test that None custom name uses default generation."""
        result = generate_template_tool_name("bug_triage", None)
        assert result == "start_bug_triage_project"

    def test_underscore_in_template_id(self):
        """Test template_id with underscores is handled correctly."""
        result = generate_template_tool_name("code_review_project")
        assert result == "start_code_review_project_project"


class TestGenerateTemplateToolDescription:
    """Tests for generate_template_tool_description function."""

    def test_custom_description_takes_precedence(self):
        """Test that custom tool_description is used when provided."""
        template = ProjectTemplate(
            template_id="test",
            name="Test Template",
            description="Template description",
            agent_groups=[],
            context="",
            tool_description="Custom tool description"
        )
        result = generate_template_tool_description(template)
        assert result == "Custom tool description"

    def test_default_description_with_template_description(self):
        """Test default description includes template name and description."""
        template = ProjectTemplate(
            template_id="test",
            name="Test Template",
            description="A test template for testing",
            agent_groups=[],
            context=""
        )
        result = generate_template_tool_description(template)
        assert "Test Template" in result
        assert "A test template for testing" in result

    def test_default_description_without_template_description(self):
        """Test default description when template has no description."""
        template = ProjectTemplate(
            template_id="test",
            name="Test Template",
            description="",
            agent_groups=[],
            context=""
        )
        result = generate_template_tool_description(template)
        assert "Test Template" in result


class TestMergeInputSchemas:
    """Tests for merge_input_schemas function."""

    def test_no_custom_schema_returns_base(self):
        """Test that no custom schema returns a copy of base schema."""
        base = {"type": "object", "properties": {"x": {"type": "string"}}}
        result = merge_input_schemas(base, None)
        assert result == base
        # Verify it's a copy, not the same object
        assert result is not base

    def test_custom_schema_overrides_base(self):
        """Test that custom schema properties are used."""
        base = {"type": "object", "properties": {"goal": {"type": "string"}}}
        custom = {
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "Custom goal"},
                "priority": {"type": "string", "enum": ["high", "low"]}
            },
            "required": ["goal", "priority"]
        }
        result = merge_input_schemas(base, custom)
        assert "priority" in result["properties"]
        assert result["properties"]["goal"]["description"] == "Custom goal"

    def test_task_is_always_required(self):
        """Test that task is always added to required if missing."""
        custom = {
            "type": "object",
            "properties": {"priority": {"type": "string"}},
            "required": ["priority"]
        }
        result = merge_input_schemas({}, custom)
        assert "task" in result["required"]

    def test_task_not_duplicated(self):
        """Test that task is not duplicated if already in required."""
        custom = {
            "type": "object",
            "properties": {"task": {"type": "string"}},
            "required": ["task"]
        }
        result = merge_input_schemas({}, custom)
        assert result["required"].count("task") == 1

    def test_type_defaults_to_object(self):
        """Test that type defaults to object if not specified."""
        custom = {"properties": {"x": {"type": "string"}}}
        result = merge_input_schemas({}, custom)
        assert result["type"] == "object"

    def test_properties_created_if_missing(self):
        """Test that properties dict is created if missing."""
        custom = {"type": "object"}
        result = merge_input_schemas({}, custom)
        assert "properties" in result
        assert "task" in result["properties"]


class TestCreateTemplateTool:
    """Tests for create_template_tool function."""

    def test_tool_has_correct_name(self):
        """Test that tool has correct name."""
        template = ProjectTemplate(
            template_id="test_project",
            name="Test",
            description="",
            agent_groups=[],
            context="",
            expose_as_tool=True,
            tool_name="custom_test_tool"
        )
        handler = AsyncMock()
        tool = create_template_tool(template, handler)
        assert tool.name == "custom_test_tool"

    def test_tool_has_correct_description(self):
        """Test that tool has correct description."""
        template = ProjectTemplate(
            template_id="test",
            name="Test Template",
            description="Template description",
            agent_groups=[],
            context="",
            expose_as_tool=True
        )
        handler = AsyncMock()
        tool = create_template_tool(template, handler)
        assert "Test Template" in tool.description

    def test_tool_has_merged_schema(self):
        """Test that tool has merged input schema."""
        template = ProjectTemplate(
            template_id="test",
            name="Test",
            description="",
            agent_groups=[],
            context="",
            expose_as_tool=True,
            input_schema={
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["high", "low"]}
                },
                "required": ["severity"]
            }
        )
        handler = AsyncMock()
        tool = create_template_tool(template, handler)
        assert "severity" in tool.input_schema["properties"]
        assert "task" in tool.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_tool_execution_calls_handler(self):
        """Test that tool execution calls the handler with correct args."""
        template = ProjectTemplate(
            template_id="test_proj",
            name="Test",
            description="",
            agent_groups=[],
            context="",
            expose_as_tool=True
        )
        handler = AsyncMock(return_value={"success": True})
        tool = create_template_tool(template, handler)

        result = await tool.execute(task="Test task", name="My Project")

        handler.assert_called_once()
        call_args = handler.call_args
        assert call_args.kwargs["template_id"] == "test_proj"
        assert call_args.kwargs["goal"] == "Test task"
        assert call_args.kwargs["name"] == "My Project"

    @pytest.mark.asyncio
    async def test_tool_execution_handles_custom_params(self):
        """Test that tool execution passes custom params to handler."""
        template = ProjectTemplate(
            template_id="test",
            name="Test",
            description="",
            agent_groups=[],
            context="",
            expose_as_tool=True,
            input_schema={
                "type": "object",
                "properties": {
                    "task": {"type": "string"},
                    "severity": {"type": "string"}
                }
            }
        )
        handler = AsyncMock(return_value={"success": True})
        tool = create_template_tool(template, handler)

        await tool.execute(task="Fix bug", severity="high")

        call_args = handler.call_args
        assert call_args.kwargs["custom_params"] == {"severity": "high"}

    @pytest.mark.asyncio
    async def test_tool_execution_project_name_alias(self):
        """Test that project_name is treated as name alias."""
        template = ProjectTemplate(
            template_id="test",
            name="Test",
            description="",
            agent_groups=[],
            context="",
            expose_as_tool=True
        )
        handler = AsyncMock(return_value={"success": True})
        tool = create_template_tool(template, handler)

        await tool.execute(task="Task", project_name="Project Name")

        call_args = handler.call_args
        assert call_args.kwargs["name"] == "Project Name"


class TestGenerateTemplateTools:
    """Tests for generate_template_tools function."""

    def test_only_exposed_templates_generate_tools(self):
        """Test that only templates with expose_as_tool=True generate tools."""
        templates = {
            "exposed": ProjectTemplate(
                template_id="exposed",
                name="Exposed",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            ),
            "not_exposed": ProjectTemplate(
                template_id="not_exposed",
                name="Not Exposed",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=False
            )
        }
        handler = AsyncMock()
        tools = generate_template_tools(templates, handler)

        assert len(tools) == 1
        assert tools[0].name == "start_exposed_project"

    def test_empty_templates_returns_empty_list(self):
        """Test that empty templates dict returns empty list."""
        tools = generate_template_tools({}, AsyncMock())
        assert tools == []

    def test_all_exposed_templates_generate_tools(self):
        """Test that all exposed templates generate tools."""
        templates = {
            f"template_{i}": ProjectTemplate(
                template_id=f"template_{i}",
                name=f"Template {i}",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            )
            for i in range(3)
        }
        handler = AsyncMock()
        tools = generate_template_tools(templates, handler)

        assert len(tools) == 3


class TestValidateTemplateToolNames:
    """Tests for validate_template_tool_names function."""

    def test_no_errors_for_unique_names(self):
        """Test that unique tool names produce no errors."""
        templates = {
            "template_a": ProjectTemplate(
                template_id="template_a",
                name="A",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            ),
            "template_b": ProjectTemplate(
                template_id="template_b",
                name="B",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True,
                tool_name="custom_b"
            )
        }
        errors = validate_template_tool_names(templates)
        assert errors == []

    def test_error_for_duplicate_default_names(self):
        """Test that duplicate default tool names produce errors."""
        # This is an edge case - same template_id would not happen in practice
        # but demonstrates the validation logic
        templates = {
            "same_id": ProjectTemplate(
                template_id="same_id",
                name="Same 1",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            ),
            "same_id_alt": ProjectTemplate(
                template_id="same_id",  # Same template_id = same default name
                name="Same 2",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            )
        }
        errors = validate_template_tool_names(templates)
        assert len(errors) == 1
        assert "Duplicate tool name" in errors[0]

    def test_error_for_duplicate_custom_names(self):
        """Test that duplicate custom tool names produce errors."""
        templates = {
            "template_a": ProjectTemplate(
                template_id="template_a",
                name="A",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True,
                tool_name="same_custom_name"
            ),
            "template_b": ProjectTemplate(
                template_id="template_b",
                name="B",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True,
                tool_name="same_custom_name"
            )
        }
        errors = validate_template_tool_names(templates)
        assert len(errors) == 1
        assert "same_custom_name" in errors[0]

    def test_non_exposed_templates_not_checked(self):
        """Test that non-exposed templates are not included in validation."""
        templates = {
            "template_a": ProjectTemplate(
                template_id="same_id",
                name="A",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=True
            ),
            "template_b": ProjectTemplate(
                template_id="same_id",  # Would conflict if exposed
                name="B",
                description="",
                agent_groups=[],
                context="",
                expose_as_tool=False  # Not exposed, so no conflict
            )
        }
        errors = validate_template_tool_names(templates)
        assert errors == []
