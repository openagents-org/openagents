"""
Simple A2A Example - Understanding the Protocol

This example shows the core A2A concepts without the full OpenAgents setup.
"""

import asyncio
from openagents.models.a2a import (
    AgentCard,
    AgentSkill,
    AgentCapabilities,
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    Role,
    create_text_message,
    create_task,
)


async def main():
    print("=" * 60)
    print("A2A Protocol Concepts")
    print("=" * 60)

    # =========================================================================
    # 1. Agent Card - How agents describe themselves
    # =========================================================================
    print("\n1. AGENT CARD (Discovery)")
    print("-" * 40)

    agent_card = AgentCard(
        name="Translation Agent",
        version="1.0.0",
        description="Translates text between languages",
        url="https://translate.example.com",
        protocol_version="0.3",
        skills=[
            AgentSkill(
                id="translate",
                name="Translate Text",
                description="Translate text from one language to another",
                input_modes=["text"],
                output_modes=["text"],
                tags=["translation", "language"],
            ),
            AgentSkill(
                id="detect-language",
                name="Detect Language",
                description="Detect the language of input text",
                input_modes=["text"],
                output_modes=["text", "data"],
            ),
        ],
        capabilities=AgentCapabilities(
            streaming=False,
            push_notifications=True,
        ),
    )

    print(f"Agent: {agent_card.name} v{agent_card.version}")
    print(f"URL: {agent_card.url}")
    print(f"Skills:")
    for skill in agent_card.skills:
        print(f"  - {skill.name}: {skill.description}")

    # =========================================================================
    # 2. Messages - How clients communicate with agents
    # =========================================================================
    print("\n2. A2A MESSAGES")
    print("-" * 40)

    # User message
    user_message = create_text_message(
        "Translate 'Hello World' to French",
        Role.USER
    )
    print(f"User Message: role={user_message.role.value}")
    for part in user_message.parts:
        if isinstance(part, TextPart):
            print(f"  Text: {part.text}")

    # Agent response
    agent_message = A2AMessage(
        role=Role.AGENT,
        parts=[
            TextPart(text="The French translation is: 'Bonjour le Monde'"),
        ],
        metadata={"source_lang": "en", "target_lang": "fr"},
    )
    print(f"\nAgent Message: role={agent_message.role.value}")
    for part in agent_message.parts:
        if isinstance(part, TextPart):
            print(f"  Text: {part.text}")
    print(f"  Metadata: {agent_message.metadata}")

    # =========================================================================
    # 3. Tasks - Tracking work and results
    # =========================================================================
    print("\n3. TASKS (Work Tracking)")
    print("-" * 40)

    # Create a task from a message
    task = create_task(user_message, context_id="session-123")

    print(f"Task ID: {task.id}")
    print(f"Context: {task.context_id}")
    print(f"Status: {task.status.state.value}")
    print(f"History: {len(task.history)} messages")

    # Simulate task state transitions
    print("\nTask State Transitions:")

    states = [
        TaskState.SUBMITTED,
        TaskState.WORKING,
        TaskState.COMPLETED,
    ]

    for state in states:
        task.status = TaskStatus(state=state)
        print(f"  → {state.value}")
        await asyncio.sleep(0.3)

    # =========================================================================
    # 4. Artifacts - Task outputs
    # =========================================================================
    print("\n4. ARTIFACTS (Results)")
    print("-" * 40)

    # Add result artifact
    artifact = Artifact(
        name="translation",
        parts=[
            TextPart(text="Bonjour le Monde"),
        ],
        index=0,
    )
    task.artifacts.append(artifact)

    print(f"Artifact: {artifact.name}")
    for part in artifact.parts:
        if isinstance(part, TextPart):
            print(f"  Content: {part.text}")

    # =========================================================================
    # 5. JSON-RPC Methods
    # =========================================================================
    print("\n5. JSON-RPC METHODS")
    print("-" * 40)

    methods = [
        ("message/send", "Send message, create or continue a task"),
        ("tasks/get", "Get task by ID with status and artifacts"),
        ("tasks/list", "List tasks, optionally filtered by context"),
        ("tasks/cancel", "Cancel a running task"),
    ]

    for method, desc in methods:
        print(f"  {method:15} - {desc}")

    # =========================================================================
    # 6. Example JSON-RPC Request/Response
    # =========================================================================
    print("\n6. EXAMPLE JSON-RPC FLOW")
    print("-" * 40)

    # Request
    request = {
        "jsonrpc": "2.0",
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"type": "text", "text": "Hello!"}],
            },
            "contextId": "session-abc",
        },
        "id": 1,
    }

    print("Request:")
    print(f"  method: {request['method']}")
    print(f"  message: {request['params']['message']['parts'][0]['text']}")
    print(f"  contextId: {request['params']['contextId']}")

    # Response
    response = {
        "jsonrpc": "2.0",
        "result": {
            "id": "task-xyz",
            "contextId": "session-abc",
            "status": {"state": "completed"},
            "artifacts": [
                {"name": "response", "parts": [{"type": "text", "text": "Hi!"}]}
            ],
        },
        "id": 1,
    }

    print("\nResponse:")
    print(f"  task_id: {response['result']['id']}")
    print(f"  status: {response['result']['status']['state']}")
    print(f"  response: {response['result']['artifacts'][0]['parts'][0]['text']}")

    print("\n" + "=" * 60)
    print("A2A enables agents to communicate using a standard protocol!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
