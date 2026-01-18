#!/usr/bin/env python3
"""
Test script for Service Alternatives Finder workflow
"""

import asyncio
import sys
from openagents.core.client import AgentClient
from openagents.models.event import Event

async def test_workflow():
    service_name = sys.argv[1] if len(sys.argv) > 1 else "Mailchimp"

    client = AgentClient(agent_id="test-client")

    try:
        # Connect to network
        print("🔌 Connecting to network...")
        success = await client.connect(
            network_host="localhost",
            network_port=8700,
            skip_detection=True,
            enforce_transport_type="http"
        )

        if not success:
            print("❌ Failed to connect to network")
            return

        print("✅ Connected to network\n")

        # Start project
        print(f"🚀 Starting project: Find alternatives to {service_name}")
        start_event = Event(
            event_name="project.start",
            source_id="test-client",
            destination_id="system",
            payload={
                "template_id": "find_alternatives",
                "name": f"Find alternatives to {service_name}",
                "goal": f"Find alternatives to {service_name}"
            }
        )

        response = await client.send_event(start_event)

        if not response or not response.success:
            print(f"❌ Failed to start project: {response.message if response else 'No response'}")
            return

        project_id = response.data.get("project_id")
        print(f"✅ Project started: {project_id}\n")

        # Poll for completion
        print("⏳ Waiting for workflow to complete...")
        for i in range(90):  # Wait up to 90 seconds
            await asyncio.sleep(1)

            get_event = Event(
                event_name="project.get",
                source_id="test-client",
                destination_id="system",
                payload={"project_id": project_id}
            )

            status_response = await client.send_event(get_event)
            project = status_response.data.get('project', {})
            status = project.get('status')
            messages = project.get('messages', [])

            if i % 5 == 0:  # Print status every 5 seconds
                print(f"  [{i}s] Status: {status}, Messages: {len(messages)}")

            if status == 'completed':
                print(f"\n✅ Project completed!\n")
                print("=" * 80)
                print("FINAL COMPARISON:")
                print("=" * 80)

                for msg in messages:
                    sender = msg.get('sender_id', 'unknown')
                    text = msg.get('content', {}).get('text', '')
                    # Match coordinator messages (sender starts with 'py-coord' or is 'coordinator')
                    if (sender.startswith('py-coord') or sender == 'coordinator') and text:
                        print(f"\n{text}\n")

                print("=" * 80)
                break
        else:
            print("\n⏰ Timeout - project did not complete in time")

    finally:
        await client.disconnect()
        print("\n✅ Disconnected")

if __name__ == '__main__':
    asyncio.run(test_workflow())
