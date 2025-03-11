"""
Integration tests for the discovery protocols.
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


class TestDiscoveryIntegration(unittest.TestCase):
    """Integration test cases for the discovery protocols."""
    
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
        
        self.network.register_protocol(self.registration_protocol)
        self.network.register_protocol(self.discoverability_protocol)
        
        # Start the network
        self.network.start()
        
        # Create agents
        self.agent1 = Agent(name="Agent1")
        self.agent2 = Agent(name="Agent2")
        self.agent3 = Agent(name="Agent3")
        
        # Start the agents
        self.agent1.start()
        self.agent2.start()
        self.agent3.start()
        
        # Register agent protocols
        self.agent1_registration = AgentRegistrationAgentProtocol(self.agent1.agent_id)
        self.agent1_discoverability = DiscoverabilityAgentProtocol(self.agent1.agent_id)
        
        self.agent2_registration = AgentRegistrationAgentProtocol(self.agent2.agent_id)
        self.agent2_discoverability = DiscoverabilityAgentProtocol(self.agent2.agent_id)
        
        self.agent3_registration = AgentRegistrationAgentProtocol(self.agent3.agent_id)
        self.agent3_discoverability = DiscoverabilityAgentProtocol(self.agent3.agent_id)
        
        self.agent1.register_protocol(self.agent1_registration)
        self.agent1.register_protocol(self.agent1_discoverability)
        
        self.agent2.register_protocol(self.agent2_registration)
        self.agent2.register_protocol(self.agent2_discoverability)
        
        self.agent3.register_protocol(self.agent3_registration)
        self.agent3.register_protocol(self.agent3_discoverability)
        
        # Connect agents to the network
        self.agent1.join_network(self.network)
        self.agent2.join_network(self.network)
        self.agent3.join_network(self.network)
    
    def tearDown(self):
        """Clean up after the test."""
        # Disconnect agents
        self.agent1.leave_network()
        self.agent2.leave_network()
        self.agent3.leave_network()
        
        # Stop the agents
        self.agent1.stop()
        self.agent2.stop()
        self.agent3.stop()
        
        # Stop the network
        self.network.stop()
    
    def test_full_discovery_workflow(self):
        """Test the full discovery workflow."""
        # 1. Register agents
        self.agent1_registration.register()
        self.agent2_registration.register()
        self.agent3_registration.register()
        
        # Check registration
        self.assertTrue(self.agent1_registration.is_registered())
        self.assertTrue(self.agent2_registration.is_registered())
        self.assertTrue(self.agent3_registration.is_registered())
        
        # 2. Advertise services
        service1 = "data-processing"
        metadata1 = {"description": "Process data", "version": "1.0.0"}
        
        service2 = "machine-learning"
        metadata2 = {"description": "ML models", "version": "2.0.0"}
        
        self.agent1_discoverability.advertise_service(service1, metadata1)
        self.agent2_discoverability.advertise_service(service2, metadata2)
        
        # 3. Discover agents
        agents = self.agent3_discoverability.discover_agents()
        
        # Check agent discovery
        self.assertEqual(len(agents), 3)
        self.assertIn(self.agent1.agent_id, agents)
        self.assertIn(self.agent2.agent_id, agents)
        self.assertIn(self.agent3.agent_id, agents)
        
        # 4. Discover services
        services = self.agent3_discoverability.discover_services()
        
        # Check service discovery
        self.assertEqual(len(services), 2)
        self.assertIn(service1, services)
        self.assertIn(service2, services)
        self.assertIn(self.agent1.agent_id, services[service1])
        self.assertIn(self.agent2.agent_id, services[service2])
        
        # 5. Get service metadata
        metadata1_retrieved = self.agent3_discoverability.get_service_metadata(service1, self.agent1.agent_id)
        metadata2_retrieved = self.agent3_discoverability.get_service_metadata(service2, self.agent2.agent_id)
        
        # Check metadata
        self.assertEqual(metadata1_retrieved, metadata1)
        self.assertEqual(metadata2_retrieved, metadata2)
        
        # 6. Unregister an agent
        self.agent1_registration.unregister()
        
        # Check unregistration
        self.assertFalse(self.agent1_registration.is_registered())
        
        # 7. Discover agents again
        agents = self.agent3_discoverability.discover_agents()
        
        # Check agent discovery after unregistration
        self.assertEqual(len(agents), 2)
        self.assertNotIn(self.agent1.agent_id, agents)
        self.assertIn(self.agent2.agent_id, agents)
        self.assertIn(self.agent3.agent_id, agents)
        
        # 8. Discover services again
        services = self.agent3_discoverability.discover_services()
        
        # Check service discovery after unregistration
        # Note: This depends on how the discoverability protocol handles unregistered agents
        # It might still show the service if it doesn't clean up after agent unregistration
        if service1 in services:
            self.assertNotIn(self.agent1.agent_id, services[service1])
        
        self.assertIn(service2, services)
        self.assertIn(self.agent2.agent_id, services[service2])


if __name__ == '__main__':
    unittest.main() 