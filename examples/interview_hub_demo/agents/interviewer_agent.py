from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_context import EventContext

COMPANY_ID = "e42a10c8-270a-47e6-8b46-f5b2694088f4"

class InterviewerAgent(WorkerAgent):
    default_agent_id = "interviewer"

    async def on_startup(self):
        pass

if __name__ == "__main__":
    interviewer_agent = InterviewerAgent()
    interviewer_agent.start(network_host="localhost")
    interviewer_agent.wait_for_stop()