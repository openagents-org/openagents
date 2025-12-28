"""
A2A Agent Skills Example

This example demonstrates how agents connect to a network and expose
their skills/capabilities via the A2A transport.

The key insight is:
1. Agents register with the network topology via AgentConnection
2. AgentConnection.metadata contains the agent's skills
3. A2ATransport._collect_skills_from_agents() reads these skills
4. Skills appear in the Agent Card at /.well-known/agent.json

Architecture:
    ┌────────────────────────────────────────────────────────────┐
    │                    AgentNetwork                            │
    │  ┌──────────────────────────────────────────────────────┐  │
    │  │  Topology (agent_registry)                           │  │
    │  │                                                      │  │
    │  │  ┌─────────────────┐  ┌─────────────────┐           │  │
    │  │  │ TranslatorAgent │  │  MathAgent      │           │  │
    │  │  │ metadata:       │  │  metadata:      │           │  │
    │  │  │  skills:        │  │   skills:       │           │  │
    │  │  │   - translate   │  │    - calculate  │           │  │
    │  │  │   - detect_lang │  │    - convert    │           │  │
    │  │  └─────────────────┘  └─────────────────┘           │  │
    │  └──────────────────────────────────────────────────────┘  │
    │                           │                                │
    │                           ▼                                │
    │  ┌──────────────────────────────────────────────────────┐  │
    │  │  A2ATransport                                        │  │
    │  │  _collect_skills_from_agents() ──► Agent Card        │  │
    │  │                                   {                  │  │
    │  │                                     "skills": [      │  │
    │  │                                       "translate",   │  │
    │  │                                       "calculate"    │  │
    │  │                                     ]                │  │
    │  │                                   }                  │  │
    │  └──────────────────────────────────────────────────────┘  │
    └────────────────────────────────────────────────────────────┘

Usage:
    python examples/a2a_agent_skills_example.py
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional

from openagents.models.transport import AgentConnection, TransportType
from openagents.models.a2a import AgentSkill
from openagents.core.transports.a2a import A2ATransport

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# =============================================================================
# Step 1: Define Agent Skills
# =============================================================================

def create_translator_agent_skills() -> List[Dict[str, Any]]:
    """
    Define skills for a Translator agent.

    Skills are defined as dictionaries that match the A2A AgentSkill schema.
    These will be stored in AgentConnection.metadata["skills"].
    """
    return [
        {
            "id": "translate",
            "name": "Translate Text",
            "description": "Translate text from one language to another",
            "input_modes": ["text"],
            "output_modes": ["text"],
            "tags": ["translation", "language", "nlp"],
            "examples": [
                "Translate 'Hello' to Spanish",
                "Convert this French text to English",
            ],
        },
        {
            "id": "detect-language",
            "name": "Detect Language",
            "description": "Detect the language of the provided text",
            "input_modes": ["text"],
            "output_modes": ["text", "data"],
            "tags": ["language", "detection"],
        },
    ]


def create_math_agent_skills() -> List[Dict[str, Any]]:
    """
    Define skills for a Math agent.
    """
    return [
        {
            "id": "calculate",
            "name": "Calculate",
            "description": "Perform mathematical calculations",
            "input_modes": ["text"],
            "output_modes": ["text", "data"],
            "tags": ["math", "calculation"],
            "examples": [
                "Calculate 42 * 2 + 8",
                "What is the square root of 144?",
            ],
        },
        {
            "id": "convert-units",
            "name": "Convert Units",
            "description": "Convert between different units of measurement",
            "input_modes": ["text"],
            "output_modes": ["text"],
            "tags": ["math", "conversion", "units"],
        },
    ]


def create_code_agent_skills() -> List[Dict[str, Any]]:
    """
    Define skills for a Code Assistant agent.
    """
    return [
        {
            "id": "code-review",
            "name": "Code Review",
            "description": "Review code for bugs, style issues, and improvements",
            "input_modes": ["text", "file"],
            "output_modes": ["text"],
            "tags": ["code", "review", "programming"],
        },
        {
            "id": "code-explain",
            "name": "Explain Code",
            "description": "Explain what a piece of code does",
            "input_modes": ["text", "file"],
            "output_modes": ["text"],
            "tags": ["code", "explanation", "education"],
        },
        {
            "id": "code-generate",
            "name": "Generate Code",
            "description": "Generate code based on requirements",
            "input_modes": ["text"],
            "output_modes": ["text", "file"],
            "tags": ["code", "generation", "programming"],
        },
    ]


# =============================================================================
# Step 2: Create Agent Connections with Skills
# =============================================================================

def create_agent_connection(
    agent_id: str,
    skills: List[Dict[str, Any]],
    description: str = "",
    transport_type: TransportType = TransportType.GRPC,
) -> AgentConnection:
    """
    Create an AgentConnection with skills in metadata.

    This is what gets registered with the network topology.
    The A2A transport reads skills from connection.metadata["skills"].
    """
    return AgentConnection(
        agent_id=agent_id,
        transport_type=transport_type,
        metadata={
            "skills": skills,
            "description": description,
            "version": "1.0.0",
        },
        capabilities=[skill["id"] for skill in skills],
        role="agent",
    )


# =============================================================================
# Step 3: Mock Network with Agent Registry
# =============================================================================

class MockNetworkTopology:
    """
    Simplified mock of NetworkTopology for demonstration.

    In a real OpenAgents setup, this would be the actual topology
    from openagents.core.topology.
    """

    def __init__(self):
        self.agent_registry: Dict[str, AgentConnection] = {}

    def register_agent(self, connection: AgentConnection) -> bool:
        """Register an agent with the network."""
        self.agent_registry[connection.agent_id] = connection
        logger.info(f"Registered agent: {connection.agent_id}")
        logger.info(f"  Skills: {[s['name'] for s in connection.metadata.get('skills', [])]}")
        return True

    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the network."""
        if agent_id in self.agent_registry:
            del self.agent_registry[agent_id]
            logger.info(f"Unregistered agent: {agent_id}")
            return True
        return False


class MockAgentNetwork:
    """
    Simplified mock of AgentNetwork for demonstration.
    """

    def __init__(self):
        self.topology = MockNetworkTopology()
        self.mods = {}  # No mods in this example

    def register_agent(self, connection: AgentConnection) -> bool:
        """Register an agent with the network."""
        return self.topology.register_agent(connection)


# =============================================================================
# Step 4: Complete Example
# =============================================================================

async def main():
    print("=" * 70)
    print("A2A Agent Skills Example")
    print("=" * 70)

    # Create mock network
    network = MockAgentNetwork()

    # ----- Register Agents with Skills -----
    print("\n1. REGISTERING AGENTS WITH SKILLS")
    print("-" * 50)

    # Create agent connections with skills
    translator_conn = create_agent_connection(
        agent_id="translator-agent",
        skills=create_translator_agent_skills(),
        description="Translates text between languages",
    )

    math_conn = create_agent_connection(
        agent_id="math-agent",
        skills=create_math_agent_skills(),
        description="Performs mathematical calculations",
    )

    code_conn = create_agent_connection(
        agent_id="code-assistant",
        skills=create_code_agent_skills(),
        description="Helps with code review and generation",
    )

    # Register agents with the network
    network.register_agent(translator_conn)
    network.register_agent(math_conn)
    network.register_agent(code_conn)

    # ----- Create A2A Transport -----
    print("\n2. CREATING A2A TRANSPORT")
    print("-" * 50)

    transport = A2ATransport(
        config={
            "port": 8900,
            "agent": {
                "name": "Multi-Agent Network",
                "version": "1.0.0",
                "description": "A network with Translation, Math, and Code agents",
            },
        },
        network=network,  # Pass the network for skill collection
    )

    print(f"Transport created for port {transport.port}")

    # ----- Collect Skills -----
    print("\n3. COLLECTING SKILLS FROM AGENTS")
    print("-" * 50)

    # This is what happens internally when generating the Agent Card
    agent_skills = transport._collect_skills_from_agents()

    print(f"Collected {len(agent_skills)} skills from agents:\n")

    for skill in agent_skills:
        print(f"  Skill: {skill.id}")
        print(f"    Name: {skill.name}")
        print(f"    Description: {skill.description}")
        print(f"    Input modes: {skill.input_modes}")
        print(f"    Output modes: {skill.output_modes}")
        print(f"    Tags: {skill.tags}")
        print()

    # ----- Generate Agent Card -----
    print("\n4. GENERATED AGENT CARD")
    print("-" * 50)

    agent_card = transport._generate_agent_card()

    print(f"Name: {agent_card.name}")
    print(f"Version: {agent_card.version}")
    print(f"Description: {agent_card.description}")
    print(f"Protocol Version: {agent_card.protocol_version}")
    print(f"\nSkills ({len(agent_card.skills)} total):")

    for skill in agent_card.skills:
        print(f"  - {skill.id}: {skill.name}")

    # ----- Show JSON Output -----
    print("\n5. AGENT CARD JSON (/.well-known/agent.json)")
    print("-" * 50)

    import json
    card_dict = agent_card.model_dump(by_alias=True, exclude_none=True)
    print(json.dumps(card_dict, indent=2))

    # ----- Dynamic Skill Updates -----
    print("\n6. DYNAMIC SKILL UPDATES")
    print("-" * 50)

    # Register a new agent
    print("Registering new 'research-agent'...")
    research_conn = create_agent_connection(
        agent_id="research-agent",
        skills=[{
            "id": "web-search",
            "name": "Web Search",
            "description": "Search the web for information",
            "input_modes": ["text"],
            "output_modes": ["text", "data"],
            "tags": ["search", "research"],
        }],
        description="Researches topics on the web",
    )
    network.register_agent(research_conn)

    # Skills are collected dynamically each time the Agent Card is requested
    new_agent_card = transport._generate_agent_card()
    print(f"\nUpdated skills count: {len(new_agent_card.skills)}")
    print("New skills:")
    for skill in new_agent_card.skills:
        if "research" in skill.tags or "search" in skill.tags:
            print(f"  - {skill.id}: {skill.name}")

    # Unregister an agent
    print("\nUnregistering 'math-agent'...")
    network.topology.unregister_agent("math-agent")

    final_card = transport._generate_agent_card()
    print(f"Final skills count: {len(final_card.skills)}")

    print("\n" + "=" * 70)
    print("Summary: Agent skills are automatically exposed via A2A!")
    print("=" * 70)


# =============================================================================
# YAML Configuration Example
# =============================================================================

YAML_EXAMPLE = """
# Example: agents/translator.yaml
#
# Agents can define skills in their YAML configuration.
# These skills will be exposed via A2A when the agent registers.

type: simple

# Agent identification
id: translator-agent

config:
  instruction: |
    You are a professional translator. You can translate text between
    any languages and detect the language of input text.

  model_name: gpt-4o-mini
  provider: openai

# A2A Skills - exposed in the Agent Card
skills:
  - id: translate
    name: Translate Text
    description: Translate text from one language to another
    input_modes: [text]
    output_modes: [text]
    tags: [translation, language]
    examples:
      - "Translate 'Hello World' to French"
      - "Convert this Spanish text to English"

  - id: detect-language
    name: Detect Language
    description: Identify the language of the provided text
    input_modes: [text]
    output_modes: [text, data]
    tags: [language, detection]

# Event triggers
triggers:
  - event: user.message
    instruction: Respond to translation requests
"""


def show_yaml_example():
    """Display the YAML configuration example."""
    print("\n" + "=" * 70)
    print("YAML CONFIGURATION EXAMPLE")
    print("=" * 70)
    print(YAML_EXAMPLE)


if __name__ == "__main__":
    asyncio.run(main())
    show_yaml_example()
