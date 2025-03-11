"""
Tests for the agent_registration protocol.
"""

import logging
import unittest
import time
from typing import Dict, Any

from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery.agent_registration.agent_protocol import AgentRegistrationAgentProtocol
from openagents.protocols.discovery.agent_registration.network_protocol import AgentRegistrationNetworkProtocol


class TestAgentRegistration(unittest.TestCase):
    """Test cases for the agent_registration protocol."""
    
    def setUp(self):
        """Set up the test environment with a network and agents."""
        # Configure logging
        logging.basicConfig(
            level=logging.DEBUG,  # Use DEBUG level to see more details
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # Create a network
        self.network = Network(name="TestNetwork")
        
        # Register network protocols
        self.registration_protocol = AgentRegistrationNetworkProtocol(config={
            "cleanup_interval": 60.0,
            "max_inactive_time": 300.0
        })
        
        self.network.register_protocol(self.registration_protocol)
        
        # Start the network
        self.network.start()
        
        # Create agents
        self.agent1 = Agent(name="Agent1")
        self.agent2 = Agent(name="Agent2")
        
        # Start the agents
        self.agent1.start()
        self.agent2.start()
        
        # Wait for agents to fully start
        time.sleep(0.2)
        
        # Register agent protocols
        self.agent1_registration = AgentRegistrationAgentProtocol(self.agent1.agent_id)
        self.agent2_registration = AgentRegistrationAgentProtocol(self.agent2.agent_id)
        
        self.agent1.register_protocol(self.agent1_registration)
        self.agent2.register_protocol(self.agent2_registration)
        
        # Connect agents to the network
        success1 = self.agent1.join_network(self.network)
        success2 = self.agent2.join_network(self.network)
        
        # Ensure connection was successful
        self.assertTrue(success1, "Agent1 failed to join the network")
        self.assertTrue(success2, "Agent2 failed to join the network")
        
        # Wait for connection to establish
        time.sleep(0.2)
    
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
        # Register agents
        success1 = self.agent1_registration.register()
        success2 = self.agent2_registration.register()
        
        # Check registration success
        self.assertTrue(success1)
        self.assertTrue(success2)
        
        # Check registration status
        self.assertTrue(self.agent1_registration.is_registered())
        self.assertTrue(self.agent2_registration.is_registered())
        
        # Check network protocol state
        self.assertEqual(len(self.registration_protocol.agents), 2)
        self.assertTrue(self.agent1.agent_id in self.registration_protocol.agents)
        self.assertTrue(self.agent2.agent_id in self.registration_protocol.agents)
    
    def test_agent_heartbeat(self):
        """Test agent heartbeat mechanism."""
        # Register agents
        self.agent1_registration.register()
        
        # Get initial last heartbeat
        initial_heartbeat = self.agent1_registration.last_heartbeat
        
        # Wait a moment
        time.sleep(0.1)
        
        # Send heartbeat
        success = self.agent1_registration.send_heartbeat()
        
        # Check heartbeat success
        self.assertTrue(success)
        
        # Check that last heartbeat was updated
        self.assertGreater(self.agent1_registration.last_heartbeat, initial_heartbeat)
    
    def test_agent_unregistration(self):
        """Test agent unregistration from the network."""
        # Register agents
        self.agent1_registration.register()
        self.agent2_registration.register()
        
        # Unregister agent1
        success = self.agent1_registration.unregister()
        
        # Check unregistration success
        self.assertTrue(success)
        
        # Check registration status
        self.assertFalse(self.agent1_registration.is_registered())
        self.assertTrue(self.agent2_registration.is_registered())
        
        # Check network protocol state
        self.assertEqual(len(self.registration_protocol.agents), 1)
        self.assertFalse(self.agent1.agent_id in self.registration_protocol.agents)
        self.assertTrue(self.agent2.agent_id in self.registration_protocol.agents)
    
    def test_inactive_agent_cleanup(self):
        """Test cleanup of inactive agents."""
        # Register agents
        self.agent1_registration.register()
        
        # Modify the max_inactive_time to a small value for testing
        self.registration_protocol.config["max_inactive_time"] = 0.1
        
        # Wait for the agent to become inactive
        time.sleep(0.2)
        
        # Get all agents (this triggers cleanup)
        agents = self.registration_protocol.get_all_agents()
        
        # Check that the inactive agent was removed
        self.assertEqual(len(agents), 0)
        self.assertFalse(self.agent1.agent_id in agents)


if __name__ == '__main__':
    unittest.main() 