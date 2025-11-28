from typing import List
from pydantic import BaseModel, Field
from openagents.models.event import Event


class EventThread(BaseModel):
    """
    A event thread maintains a list of events in a channel.
    """

    events: List[Event] = Field(
        default_factory=list, description="The list of messages in the thread"
    )

    def add_event(self, message: Event):
        """
        Add a message to the message thread.
        Skips adding if an event with the same event_id already exists (deduplication).
        """
        # Check for duplicate event_id to prevent adding the same event twice
        # This can happen when an agent sends a message and also receives it back from the network
        if any(e.event_id == message.event_id for e in self.events):
            return
        self.events.append(message)

    def get_events(self) -> List[Event]:
        """
        Get the messages in the message thread.
        """
        # sort the messages by timestamp
        return list(sorted(self.events, key=lambda x: x.timestamp))
