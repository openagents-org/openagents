from typing import List
from pydantic import BaseModel, Field
from openagents.models.messages import BaseMessage


class MessageThread(BaseModel):
    """
    A message thread maintains a list of messages in a channel.
    """
    messages: List[BaseMessage] = Field(default_factory=list, description="The list of messages in the thread")

    def add_message(self, message: BaseMessage):
        """
        Add a message to the message thread.
        """
        self.messages.append(message)

    def get_messages(self) -> List[BaseMessage]:
        """
        Get the messages in the message thread.
        """
        # sort the messages by timestamp
        return list(sorted(self.messages, key=lambda x: x.timestamp))

