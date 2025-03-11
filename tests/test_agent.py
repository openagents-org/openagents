import unittest
from unittest.mock import MagicMock, patch
import uuid

from openagents.core.agent import Agent
from openagents.core.agent_protocol_base import AgentProtocolBase


class MockProtocol(AgentProtocolBase):
    """Mock protocol for testing."""
    
    def __init__(self, agent_id, config=None):
        super().__init__(agent_id, config)
        self.initialize_called = False
        self.shutdown_called = False
        self.handle_message_called = False
        self.last_message = None
    
    def initialize(self) -> bool:
        self.initialize_called = True
        return True
    
    def shutdown(self) -> bool:
        self.shutdown_called = True
        return True
    
    @property
    def capabilities(self):
        return ["mock-capability"]
    
    def handle_message(self, message):
        self.handle_message_called = True
        self.last_message = message
        return {"status": "success"}
    
    def get_agent_state(self):
        return {"status": "active"}


# Rest of the file remains the same 