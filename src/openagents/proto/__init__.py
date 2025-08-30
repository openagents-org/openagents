"""Generated gRPC code for OpenAgents."""

from .agent_service_pb2 import *
from .agent_service_pb2_grpc import *

__all__ = [
    # Messages
    'Message',
    'MessageResponse', 
    'RegisterAgentRequest',
    'RegisterAgentResponse',
    'UnregisterAgentRequest',
    'UnregisterAgentResponse',
    'DiscoverAgentsRequest',
    'DiscoverAgentsResponse',
    'GetAgentInfoRequest',
    'GetAgentInfoResponse',
    'AgentInfo',
    'SystemCommandRequest',
    'SystemCommandResponse',
    'PingRequest',
    'PingResponse',
    'NetworkInfoRequest',
    'NetworkInfoResponse',
    
    # Service
    'AgentServiceServicer',
    'AgentServiceStub',
    'add_AgentServiceServicer_to_server',
]