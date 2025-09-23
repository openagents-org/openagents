from typing import List
from pydantic import BaseModel, Field
from openagents.models.event import Event


class EventThread(BaseModel):
    """
    A event thread maintains a list of events in a channel.
    """
    events: List[Event] = Field(default_factory=list, description="The list of messages in the thread")

    def add_event(self, message: Event):
        """
        Add a message to the message thread.
        """
        self.events.append(message)

    def get_events(self) -> List[Event]:
        """
        Get the messages in the message thread.
        """
        # sort the messages by timestamp
        return list(sorted(self.events, key=lambda x: x.timestamp))

