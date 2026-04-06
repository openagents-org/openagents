"""
CrewAI Agent Runner for OpenAgents.

This module provides a wrapper that allows CrewAI crews to connect
to and participate in the OpenAgents network.

CrewAI enables role-based multi-agent collaboration, making it ideal
for complex tasks requiring specialized agents working together.

Example usage:
    from crewai import Agent, Task, Crew
    from openagents.agents import CrewAIAgentRunner

    # Create your CrewAI agents
    researcher = Agent(
        role='Researcher',
        goal='Find accurate information',
        backstory='Expert researcher with attention to detail'
    )
    
    writer = Agent(
        role='Writer', 
        goal='Create clear content',
        backstory='Skilled writer who explains complex topics simply'
    )

    # Create tasks
    research_task = Task(
        description='Research the topic: {input}',
        agent=researcher
    )
    write_task = Task(
        description='Write about the research findings',
        agent=writer
    )

    # Create crew
    crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task])

    # Connect to OpenAgents network
    runner = CrewAIAgentRunner(
        crew=crew,
        agent_id="my-crew-agent"
    )
    runner.start(network_host="localhost", network_port=8600)
    runner.wait_for_stop()
"""

import logging
from typing import Any, Callable, Dict, List, Optional, Set

from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type aliases to avoid hard dependency
CrewAICrew = Any
CrewAIAgent = Any
CrewAITask = Any


def openagents_tool_to_crewai(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a CrewAI tool.

    Args:
        agent_tool: The OpenAgents tool to convert

    Returns:
        A CrewAI-compatible tool

    Raises:
        ImportError: If crewai is not installed
    """
    try:
        from crewai.tools import BaseTool
        import asyncio
    except ImportError:
        raise ImportError(
            "crewai is required for tool conversion. "
            "Install it with: pip install crewai"
        )

    class WrappedOpenAgentsTool(BaseTool):
        name: str = agent_tool.name
        description: str = agent_tool.description

        def _run(self, **kwargs) -> str:
            """Execute the OpenAgents tool synchronously."""
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(
                            asyncio.run,
                            agent_tool.execute(**kwargs)
                        )
                        return str(future.result())
                else:
                    return str(loop.run_until_complete(
                        agent_tool.execute(**kwargs)
                    ))
            except Exception as e:
                return f"Tool execution failed: {e}"

    return WrappedOpenAgentsTool()


def crewai_tool_to_openagents(crewai_tool: Any) -> AgentTool:
    """
    Convert a CrewAI tool to an OpenAgents AgentTool.

    Args:
        crewai_tool: The CrewAI tool to convert

    Returns:
        An OpenAgents AgentTool instance
    """
    import asyncio

    name = getattr(crewai_tool, 'name', crewai_tool.__class__.__name__)
    description = getattr(crewai_tool, 'description', '')

    async def tool_func(**kwargs) -> Any:
        if hasattr(crewai_tool, '_run'):
            result = crewai_tool._run(**kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result
        return str(crewai_tool)

    return AgentTool(
        name=name,
        description=description,
        input_schema={},
        func=tool_func,
    )


class CrewAIAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a CrewAI Crew for use in OpenAgents network.

    This class bridges CrewAI's multi-agent collaboration framework with
    OpenAgents' network capabilities, allowing CrewAI crews to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools across all crew members
    - Send collaborative responses back to other agents

    CrewAI is designed for role-based agent collaboration where each agent
    has a specific role, goal, and backstory. Tasks are assigned to agents
    and executed in sequence or parallel.

    Example:
        from crewai import Agent, Task, Crew
        from openagents.agents import CrewAIAgentRunner

        # Define specialized agents
        analyst = Agent(role='Analyst', goal='Analyze data')
        reporter = Agent(role='Reporter', goal='Create reports')

        # Define tasks
        analyze = Task(description='Analyze: {input}', agent=analyst)
        report = Task(description='Report findings', agent=reporter)

        # Create crew and connect to OpenAgents
        crew = Crew(agents=[analyst, reporter], tasks=[analyze, report])
        runner = CrewAIAgentRunner(crew=crew, agent_id='my-crew')
        runner.start(network_host='localhost', network_port=8600)
    """

    def __init__(
        self,
        crew: CrewAICrew,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        response_handler: Optional[Callable[[EventContext, str], None]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        input_key: str = "input",
        **kwargs
    ):
        """
        Initialize the CrewAI agent runner.

        Args:
            crew: The CrewAI Crew instance to wrap. Must have a `kickoff` method.
            agent_id: ID for this agent on the network. If not provided,
                will be auto-generated.
            include_network_tools: If True, OpenAgents network tools will be
                added to all agents in the crew.
            response_handler: Optional custom handler for processing responses.
                If provided, it will be called with (context, response_text)
                instead of the default broadcast behavior.
            event_names: Optional list of event names to react to.
            event_filter: Optional custom filter function.
            input_key: The key to use for input in kickoff inputs dict.
                Defaults to "input".
            **kwargs: Additional arguments passed to AgentRunner.
        """
        super().__init__(agent_id=agent_id, **kwargs)

        self._crew = crew
        self._include_network_tools = include_network_tools
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._input_key = input_key
        self._tools_injected = False

        # Validate the CrewAI crew
        if not hasattr(crew, 'kickoff'):
            raise ValueError(
                "crew must have a 'kickoff' method. "
                "Make sure you're passing a CrewAI Crew instance."
            )

        logger.info(f"Initialized CrewAIAgentRunner with agent_id={agent_id}")

    @property
    def crew(self) -> CrewAICrew:
        """Get the wrapped CrewAI crew."""
        return self._crew

    def _should_react(self, context: EventContext) -> bool:
        """Determine if the agent should react to the given event."""
        event = context.incoming_event

        if self._event_names is not None:
            if event.event_name not in self._event_names:
                logger.debug(f"Skipping event '{event.event_name}' - not in allowed list")
                return False

        if self._event_filter is not None:
            try:
                if not self._event_filter(context):
                    logger.debug(f"Skipping event - rejected by custom filter")
                    return False
            except Exception as e:
                logger.error(f"Error in event_filter: {e}")
                return False

        return True

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """Inject OpenAgents network tools into all CrewAI agents."""
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            crewai_tools = [
                openagents_tool_to_crewai(tool)
                for tool in openagents_tools
            ]

            # Add tools to all agents in the crew
            if hasattr(self._crew, 'agents'):
                for agent in self._crew.agents:
                    if hasattr(agent, 'tools'):
                        if agent.tools is None:
                            agent.tools = []
                        agent.tools.extend(crewai_tools)
                
                logger.info(
                    f"Injected {len(crewai_tools)} OpenAgents tools "
                    f"into {len(self._crew.agents)} CrewAI agents"
                )
            else:
                logger.warning("Crew does not have 'agents' attribute")
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    def _extract_input_text(self, context: EventContext) -> str:
        """Extract the input text from an EventContext."""
        event = context.incoming_event

        if hasattr(event, 'text_representation') and event.text_representation:
            return event.text_representation

        if isinstance(event.payload, dict):
            content = event.payload.get('content', {})
            if isinstance(content, dict) and 'text' in content:
                return content['text']
            if 'text' in event.payload:
                return event.payload['text']
            if 'message' in event.payload:
                return str(event.payload['message'])

        if event.payload:
            return str(event.payload)

        return ""

    def _extract_output(self, result: Any) -> str:
        """Extract the output string from a CrewAI kickoff result."""
        # CrewAI returns a CrewOutput object
        if hasattr(result, 'raw'):
            return str(result.raw)
        
        if hasattr(result, 'output'):
            return str(result.output)
        
        if isinstance(result, str):
            return result

        # Try to get the last task output
        if hasattr(result, 'tasks_output') and result.tasks_output:
            last_output = result.tasks_output[-1]
            if hasattr(last_output, 'raw'):
                return str(last_output.raw)
            return str(last_output)

        return str(result)

    async def react(self, context: EventContext):
        """React to an incoming message by running the CrewAI crew."""
        if not self._should_react(context):
            return

        try:
            input_text = self._extract_input_text(context)

            logger.debug(f"Running CrewAI crew with input: {input_text[:100]}...")

            # Run the crew
            import asyncio
            import concurrent.futures

            # CrewAI's kickoff is synchronous, run in executor
            with concurrent.futures.ThreadPoolExecutor() as executor:
                loop = asyncio.get_event_loop()
                
                # Prepare inputs dict
                inputs = {self._input_key: input_text}
                
                # Add metadata that might be useful
                inputs['_openagents_metadata'] = {
                    'source_id': context.incoming_event.source_id,
                    'thread_id': context.incoming_thread_id,
                    'event_id': context.incoming_event.event_id,
                }
                
                result = await loop.run_in_executor(
                    executor,
                    lambda: self._crew.kickoff(inputs=inputs)
                )

            output_text = self._extract_output(result)

            logger.debug(f"CrewAI crew response: {output_text[:100]}...")

            await self._send_response(context, output_text)

        except Exception as e:
            logger.error(f"Error in CrewAI crew execution: {e}")
            error_message = f"I encountered an error: {str(e)}"
            await self._send_response(context, error_message)

    async def _send_response(self, context: EventContext, response_text: str):
        """Send the response back to the network."""
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
                "content": {
                    "text": response_text
                },
                "response_to": context.incoming_event.event_id,
            },
        )

        await self.send_event(response_event)
        logger.debug(f"Sent response to {source_id}")


def create_crewai_runner(
    crew: CrewAICrew,
    agent_id: Optional[str] = None,
    **kwargs
) -> CrewAIAgentRunner:
    """
    Convenience function to create a CrewAIAgentRunner.

    Args:
        crew: The CrewAI Crew to wrap
        agent_id: Optional agent ID
        **kwargs: Additional arguments for CrewAIAgentRunner

    Returns:
        A configured CrewAIAgentRunner instance
    """
    return CrewAIAgentRunner(
        crew=crew,
        agent_id=agent_id,
        **kwargs
    )
