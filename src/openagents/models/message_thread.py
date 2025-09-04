from typing import List
from pydantic import BaseModel, Field
from openagents.models.event import Event


class MessageThread(BaseModel):
    """
    A message thread maintains a list of messages in a channel.
    """
    messages: List[Event] = Field(default_factory=list, description="The list of messages in the thread")

    def add_message(self, message: Event):
        """
        Add a message to the message thread.
        """
        self.messages.append(message)

    def get_messages(self) -> List[Event]:
        """
        Get the messages in the message thread.
        """
        # sort the messages by timestamp
        return list(sorted(self.messages, key=lambda x: x.timestamp))

