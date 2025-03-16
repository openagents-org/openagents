from abc import ABC, abstractmethod
from typing import Dict, List, Optional

from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage
from openagents.models.tool import AgentAdapterTool
from openagents.core.client import AgentClient
from openagents.utils.protocol_loaders import load_protocol_adapters

class BaseAgentRunner(ABC):
    """Base class for agent runners in OpenAgents.
    
    Agent runners are responsible for managing the agent's lifecycle and handling
    incoming messages from the network. They implement the core logic for how an
    agent should respond to messages and interact with protocols.
    """

    def __init__(self, agent_id: Optional[str] = None, protocol_names: Optional[List[str]] = None, client: Optional[AgentClient] = None):
        """Initialize the agent runner.
        
        Args:
            agent_id: ID of the agent. Optional, if provided, the runner will use the agent ID to identify the agent.   
            protocol_names: List of protocol names to use for the agent. Optional, if provided, the runner will try to obtain required protocol adapters from the server.
            client: Agent client to use for the agent. Optional, if provided, the runner will use the client to obtain required protocol adapters.
        """
        self._agent_id = agent_id
        self._preset_protocol_names = protocol_names
        self._client = client
        self._tools = []
        self._supported_protocols = None
        # Initialize the client if it is not provided
        if self._client is None:
            protocol_adapters = []
            if self._preset_protocol_names is not None:
                protocol_adapters = load_protocol_adapters(self._preset_protocol_names)
            self._client = AgentClient(agent_id=self._agent_id, protocol_adapters=protocol_adapters)
        if self._preset_protocol_names is not None:
            self._supported_protocols = self._preset_protocol_names
            self.update_tools()
    
    def update_tools(self):
        """Update the tools available to the agent.
        
        This method should be called when the available tools might have changed,
        such as after connecting to a server or registering new protocol adapters.
        """
        self._tools = self.client.get_tools()
    
    @property
    def client(self) -> AgentClient:
        """Get the agent client.
        
        Returns:
            AgentClient: The agent client used by this runner.
        """
        return self._client
    
    @property
    def tools(self) -> List[AgentAdapterTool]:
        """Get the tools available to the agent.
        
        Returns:
            List[AgentAdapterTool]: The list of tools available to the agent.
        """
        return self._tools

    @abstractmethod
    def react(self, conversation_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to an incoming message.
        
        This method is called when a new message is received and should implement
        the agent's logic for responding to messages.
        
        Args:
            conversation_threads: Dictionary of all conversation threads available to the agent.
            incoming_thread_id: ID of the thread containing the incoming message.
            incoming_message: The incoming message to react to.
        """
        pass
    
    def start(self, host: str, port: int):
        """Start the agent runner.
        
        This method should be called when the agent runner is ready to start receiving messages.
        """
        pass
