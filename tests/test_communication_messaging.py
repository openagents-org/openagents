"""
Tests for the messaging protocol.
"""

import logging
import unittest
import time
from typing import Dict, Any

from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery.agent_registration.agent_protocol import AgentRegistrationAgentProtocol
from openagents.protocols.discovery.agent_registration.network_protocol import AgentRegistrationNetworkProtocol
from openagents.protocols.discovery.discoverability.agent_protocol import DiscoverabilityAgentProtocol
from openagents.protocols.discovery.discoverability.network_protocol import DiscoverabilityNetworkProtocol
from openagents.protocols.communication.messaging.agent_protocol import MessagingAgentProtocol
from openagents.protocols.communication.messaging.network_protocol import MessagingNetworkProtocol


class TestAgentCommunication(unittest.TestCase):
    """Test cases for agent communication using the messaging protocol."""
    
    def setUp(self):
        """Set up the test environment with a network and agents."""
        # Configure logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # Create a network
        self.network = Network(name="TestNetwork")
        
        # Register network protocols
        self.registration_protocol = AgentRegistrationNetworkProtocol()
        self.discoverability_protocol = DiscoverabilityNetworkProtocol()
        self.messaging_protocol = MessagingNetworkProtocol()
        
        self.network.register_protocol(self.registration_protocol)
        self.network.register_protocol(self.discoverability_protocol)
        self.network.register_protocol(self.messaging_protocol)
        
        # Start the network
        self.network.start()
        
        # Create agents
        self.agent1 = Agent(name="Agent1")
        self.agent2 = Agent(name="Agent2")
        
        # Start the agents
        self.agent1.start()
        self.agent2.start()
        
        # Register agent protocols
        self.agent1_registration = AgentRegistrationAgentProtocol(self.agent1.agent_id)
        self.agent1_discoverability = DiscoverabilityAgentProtocol(self.agent1.agent_id)
        self.agent1_messaging = MessagingAgentProtocol(self.agent1.agent_id)
        
        self.agent2_registration = AgentRegistrationAgentProtocol(self.agent2.agent_id)
        self.agent2_discoverability = DiscoverabilityAgentProtocol(self.agent2.agent_id)
        self.agent2_messaging = MessagingAgentProtocol(self.agent2.agent_id)
        
        self.agent1.register_protocol(self.agent1_registration)
        self.agent1.register_protocol(self.agent1_discoverability)
        self.agent1.register_protocol(self.agent1_messaging)
        
        self.agent2.register_protocol(self.agent2_registration)
        self.agent2.register_protocol(self.agent2_discoverability)
        self.agent2.register_protocol(self.agent2_messaging)
        
        # Connect agents to the network
        self.agent1.join_network(self.network)
        self.agent2.join_network(self.network)
        
        # Register agents with the network
        self.agent1_registration.register()
        self.agent2_registration.register()
    
    def tearDown(self):
        """Clean up after the test."""
        # Disconnect agents
        self.agent1.leave_network()
        self.agent2.leave_network()
        
        # Stop the agents
        self.agent1.stop()
        self.agent2.stop()
        
        # Stop the network
        self.network.stop()
    
    def test_agent_registration(self):
        """Test agent registration with the network."""
        # Check registration status
        self.assertTrue(self.agent1_registration.is_registered())
        self.assertTrue(self.agent2_registration.is_registered())
        
        # Discover agents
        agents = self.agent1_discoverability.discover_agents()
        
        # Check discovery results
        self.assertEqual(len(agents), 2)
        self.assertIn(self.agent1.agent_id, agents)
        self.assertIn(self.agent2.agent_id, agents)
    
    def test_agent_metadata(self):
        """Test agent metadata retrieval."""
        # Get agent metadata
        metadata1 = self.agent1_discoverability.get_agent_metadata(self.agent2.agent_id)
        metadata2 = self.agent2_discoverability.get_agent_metadata(self.agent1.agent_id)
        
        # Check metadata
        self.assertIsNotNone(metadata1)
        self.assertIsNotNone(metadata2)
        self.assertIsInstance(metadata1, dict)
        self.assertIsInstance(metadata2, dict)
    
    def test_direct_messaging(self):
        """Test direct messaging between agents."""
        # Define message
        message = {
            "type": "greeting",
            "content": "Hello, Agent2!"
        }
        
        # Set up a message handler for agent2
        received_messages = []
        
        def message_handler(sender_id, msg_type, content):
            received_messages.append({
                "sender_id": sender_id,
                "type": msg_type,
                "content": content
            })
            return True
        
        self.agent2_messaging.register_message_handler("greeting", message_handler)
        
        # Send message from agent1 to agent2
        success = self.agent1_messaging.send_message(self.agent2.agent_id, "greeting", message["content"])
        
        # Check send success
        self.assertTrue(success)
        
        # Wait a moment for message delivery
        time.sleep(0.1)
        
        # Check message reception
        self.assertEqual(len(received_messages), 1)
        self.assertEqual(received_messages[0]["sender_id"], self.agent1.agent_id)
        self.assertEqual(received_messages[0]["type"], "greeting")
        self.assertEqual(received_messages[0]["content"], message["content"])
    
    def test_request_response(self):
        """Test request-response pattern."""
        # Define request
        request_content = "What is your status?"
        
        # Set up a message handler for agent2 that responds to requests
        def message_handler(sender_id, msg_type, content):
            # Send a response back
            response = f"I'm agent {self.agent2.agent_id} and I'm doing fine!"
            self.agent2_messaging.send_message(sender_id, "response", response)
            return True
        
        self.agent2_messaging.register_message_handler("status_request", message_handler)
        
        # Set up a response handler for agent1
        received_responses = []
        
        def response_handler(sender_id, msg_type, content):
            received_responses.append({
                "sender_id": sender_id,
                "type": msg_type,
                "content": content
            })
            return True
        
        self.agent1_messaging.register_message_handler("response", response_handler)
        
        # Send request from agent1 to agent2
        self.agent1_messaging.send_message(self.agent2.agent_id, "status_request", request_content)
        
        # Wait a moment for message delivery and response
        time.sleep(0.2)
        
        # Check response
        self.assertEqual(len(received_responses), 1)
        self.assertEqual(received_responses[0]["sender_id"], self.agent2.agent_id)
        self.assertEqual(received_responses[0]["type"], "response")
        self.assertIn(self.agent2.agent_id, received_responses[0]["content"])
        self.assertIn("fine", received_responses[0]["content"])


if __name__ == '__main__':
    unittest.main() 