"""
Test for basic agent-network connection.
"""

import logging
import unittest
import time
from typing import Dict, Any

from openagents.core.agent import Agent
from openagents.core.network import Network


class TestAgentNetworkConnection(unittest.TestCase):
    """Test case for basic agent-network connection."""
    
    def test_agent_network_connection(self):
        """Test basic agent-network connection."""
        # Configure logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # Create a network
        network = Network(name="TestNetwork")
        
        # Start the network
        network.start()
        
        # Create an agent
        agent = Agent(name="TestAgent")
        
        # Start the agent
        agent.start()
        
        # Connect the agent to the network
        connected = agent.join_network(network)
        
        # Check connection success
        self.assertTrue(connected)
        
        # Check if agent is part of the network
        self.assertEqual(agent.network, network)
        
        # Disconnect the agent
        agent.leave_network()
        
        # Check disconnection
        self.assertIsNone(agent.network)
        
        # Stop the agent
        agent.stop()
        
        # Stop the network
        network.stop()


if __name__ == '__main__':
    unittest.main() 