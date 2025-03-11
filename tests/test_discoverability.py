"""
Tests for the discoverability protocol.
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


class TestDiscoverability(unittest.TestCase):
    """Test cases for the discoverability protocol."""
    
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
        self.provider = Agent(name="ServiceProvider")
        self.consumer = Agent(name="ServiceConsumer")
        
        # Start the agents
        self.provider.start()
        self.consumer.start()
        
        # Register agent protocols
        self.provider_registration = AgentRegistrationAgentProtocol(self.provider.agent_id)
        self.provider_discoverability = DiscoverabilityAgentProtocol(self.provider.agent_id)
        
        self.consumer_registration = AgentRegistrationAgentProtocol(self.consumer.agent_id)
        self.consumer_discoverability = DiscoverabilityAgentProtocol(self.consumer.agent_id)
        
        self.provider.register_protocol(self.provider_registration)
        self.provider.register_protocol(self.provider_discoverability)
        
        self.consumer.register_protocol(self.consumer_registration)
        self.consumer.register_protocol(self.consumer_discoverability)
        
        # Connect agents to the network
        self.provider.join_network(self.network)
        self.consumer.join_network(self.network)
        
        # Register agents with the network
        self.provider_registration.register()
        self.consumer_registration.register()
    
    def tearDown(self):
        """Clean up after the test."""
        # Disconnect agents
        self.provider.leave_network()
        self.consumer.leave_network()
        
        # Stop the agents
        self.provider.stop()
        self.consumer.stop()
        
        # Stop the network
        self.network.stop()
    
    def test_service_advertisement(self):
        """Test service advertisement."""
        # Define a service
        service_name = "data-processing"
        service_metadata = {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON",
            "version": "1.0.0"
        }
        
        # Advertise the service
        success = self.provider_discoverability.advertise_service(service_name, service_metadata)
        
        # Check advertisement success
        self.assertTrue(success)
        
        # Check provider state
        self.assertIn(service_name, self.provider_discoverability.advertised_services)
        self.assertEqual(
            self.provider_discoverability.advertised_services[service_name],
            service_metadata
        )
        
        # Check network protocol state
        self.assertIn(service_name, self.discoverability_protocol.service_registry)
        self.assertIn(self.provider.agent_id, self.discoverability_protocol.service_registry[service_name])
    
    def test_service_discovery(self):
        """Test service discovery."""
        # Define and advertise a service
        service_name = "data-processing"
        service_metadata = {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON",
            "version": "1.0.0"
        }
        
        self.provider_discoverability.advertise_service(service_name, service_metadata)
        
        # Discover services
        services = self.consumer_discoverability.discover_services()
        
        # Check discovery results
        self.assertIn(service_name, services)
        self.assertIn(self.provider.agent_id, services[service_name])
        
        # Get service providers
        providers = self.consumer_discoverability.get_service_providers(service_name)
        
        # Check providers
        self.assertIn(self.provider.agent_id, providers)
    
    def test_service_metadata(self):
        """Test service metadata retrieval."""
        # Define and advertise a service
        service_name = "data-processing"
        service_metadata = {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON",
            "version": "1.0.0"
        }
        
        self.provider_discoverability.advertise_service(service_name, service_metadata)
        
        # Get service metadata
        metadata = self.consumer_discoverability.get_service_metadata(service_name, self.provider.agent_id)
        
        # Check metadata
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata, service_metadata)
    
    def test_service_unadvertisement(self):
        """Test service unadvertisement."""
        # Define and advertise a service
        service_name = "data-processing"
        service_metadata = {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON",
            "version": "1.0.0"
        }
        
        self.provider_discoverability.advertise_service(service_name, service_metadata)
        
        # Unadvertise the service
        success = self.provider_discoverability.unadvertise_service(service_name)
        
        # Check unadvertisement success
        self.assertTrue(success)
        
        # Check provider state
        self.assertNotIn(service_name, self.provider_discoverability.advertised_services)
        
        # Check network protocol state
        if service_name in self.discoverability_protocol.service_registry:
            self.assertNotIn(self.provider.agent_id, self.discoverability_protocol.service_registry[service_name])
    
    def test_agent_discovery(self):
        """Test agent discovery."""
        # Discover agents
        agents = self.consumer_discoverability.discover_agents()
        
        # Check discovery results
        self.assertIn(self.provider.agent_id, agents)
        self.assertIn(self.consumer.agent_id, agents)
    
    def test_agent_capabilities(self):
        """Test agent capability discovery."""
        # Get agent capabilities
        capabilities = self.consumer_discoverability.get_agent_capabilities(self.provider.agent_id)
        
        # Check capabilities
        self.assertIsInstance(capabilities, list)
        
        # Get agent metadata
        metadata = self.consumer_discoverability.get_agent_metadata(self.provider.agent_id)
        
        # Check metadata
        self.assertIsNotNone(metadata)
        self.assertIsInstance(metadata, dict)


if __name__ == '__main__':
    unittest.main() 