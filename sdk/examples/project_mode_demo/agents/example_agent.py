import asyncio
from openagents.agents.worker_agent import WorkerAgent, on_event
from openagents.models.event import Event
from openagents.models import event
from openagents.models.event_context import EventContext, ChannelMessageContext
from openagents.utils.password_utils import hash_password

class ExampleProjectWorkerAgent(WorkerAgent):

    default_agent_id = "example_project_worker"

    @on_event("project.notification.started")
    async def on_project_started(self, context: EventContext):
        goal_text = context.incoming_event.payload["goal"]
        await self.send_event(Event(
            event_name="project.message.send",
            destination_id="mod:openagents.mods.workspace.project",
            payload={
                "project_id": context.incoming_event.payload["project_id"],
                "content": {
                    "text": f"Project started observed by {self.agent_id}. Goal: {goal_text}\n\nWhat is your name?",
                }
            }
        ))

    @on_event("project.notification.message_received")
    async def on_project_message_received(self, context: EventContext):
        for i in range(1, 4):
            await self.send_event(Event(
                event_name="project.message.send",
                destination_id="mod:openagents.mods.workspace.project",
                payload={
                    "project_id": context.incoming_event.payload["project_id"],
                    "content": {
                        "text": f"Working on the project... {i}/3",
                    }
                }
            ))
            await asyncio.sleep(1)
        # Complete the project
        await self.send_event(Event(
            event_name="project.complete",
            destination_id="mod:openagents.mods.workspace.project",
            payload={
                "project_id": context.incoming_event.payload["project_id"],
                "summary": f"Project completed successfully by {self.agent_id}.",
            }
        ))



if __name__ == "__main__":
    agent = ExampleProjectWorkerAgent()
    agent.start(network_host="localhost", password_hash=hash_password("123456"))
    agent.wait_for_stop()