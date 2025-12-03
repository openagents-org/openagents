"""
Example: LangChain Agent on OpenAgents Network

This example demonstrates how to connect a LangChain agent to the
OpenAgents network, allowing it to receive messages and respond
using LangChain's agent framework.

Prerequisites:
    pip install langchain langchain-openai openagents

Usage:
    # Start an OpenAgents network first, then:
    python langchain_agent_example.py
"""

import asyncio
import os
from typing import Optional

# Check for required dependencies
try:
    from langchain_openai import ChatOpenAI
    from langchain.agents import create_tool_calling_agent, AgentExecutor
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
    from langchain_core.tools import tool
except ImportError:
    print("LangChain dependencies not installed. Install with:")
    print("  pip install langchain langchain-openai langchain-core")
    exit(1)

from openagents.agents import LangChainAgentRunner


# Define some example tools for the LangChain agent
@tool
def get_weather(location: str) -> str:
    """Get the current weather for a location."""
    # Simulated weather data
    weather_data = {
        "new york": "Sunny, 72°F",
        "london": "Cloudy, 58°F",
        "tokyo": "Rainy, 65°F",
        "default": "Clear skies, 70°F"
    }
    return weather_data.get(location.lower(), weather_data["default"])


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression."""
    try:
        # Safe evaluation of mathematical expressions
        result = eval(expression, {"__builtins__": {}}, {})
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {str(e)}"


def create_langchain_agent():
    """Create a LangChain agent with tools."""
    # Initialize the LLM
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        # Uses OPENAI_API_KEY environment variable
    )

    # Define the tools
    tools = [get_weather, calculate]

    # Create the prompt template
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a helpful assistant connected to the OpenAgents network. "
            "You can help with weather information and calculations. "
            "Be concise and friendly in your responses."
        ),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    # Create the agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # Wrap in AgentExecutor
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,  # Set to False in production
        handle_parsing_errors=True,
    )

    return executor


def main():
    """Main entry point."""
    print("=" * 60)
    print("LangChain Agent - OpenAgents Network Example")
    print("=" * 60)

    # Check for OpenAI API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nWarning: OPENAI_API_KEY not set in environment")
        print("Set it with: export OPENAI_API_KEY=your-key-here\n")

    # Create the LangChain agent
    print("\n1. Creating LangChain agent...")
    langchain_agent = create_langchain_agent()
    print("   LangChain agent created with tools: get_weather, calculate")

    # Create the OpenAgents runner
    print("\n2. Creating OpenAgents runner...")
    runner = LangChainAgentRunner(
        langchain_agent=langchain_agent,
        agent_id="langchain-assistant",
        include_network_tools=True,  # Include OpenAgents network tools
    )
    print(f"   Runner created with agent_id: {runner.agent_id}")

    # Connect to the network
    print("\n3. Connecting to OpenAgents network...")
    print("   Host: localhost, Port: 8600 (default gRPC)")

    try:
        runner.start(
            network_host="localhost",
            network_port=8600,
        )
        print("   Connected successfully!")
        print("\n" + "=" * 60)
        print("Agent is now listening for messages...")
        print("Send a message to 'langchain-assistant' from another agent")
        print("Press Ctrl+C to stop")
        print("=" * 60 + "\n")

        # Wait for the agent to be stopped
        runner.wait_for_stop()

    except KeyboardInterrupt:
        print("\n\nShutting down...")
        runner.stop()
    except Exception as e:
        print(f"\nError: {e}")
        print("Make sure an OpenAgents network is running on localhost:8600")


if __name__ == "__main__":
    main()
