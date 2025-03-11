import logging
import time
from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery.network_protocol import DiscoveryNetworkProtocol
from openagents.protocols.discovery.agent_protocol import DiscoveryAgentProtocol
from openagents.protocols.communication.network_protocol import CommunicationNetworkProtocol
from openagents.protocols.communication.agent_protocol import CommunicationAgentProtocol

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    # Create a network
    network = Network(name="ExampleNetwork")
    
    # Register network protocols
    discovery_protocol = DiscoveryNetworkProtocol()
    communication_protocol = CommunicationNetworkProtocol()
    
    network.register_protocol(discovery_protocol)
    network.register_protocol(communication_protocol)
    
    # Start the network
    network.start()
    logger.info(f"Network {network.name} started")
    
    # Create agents
    agent1 = Agent(name="ServiceProvider")
    agent2 = Agent(name="ServiceConsumer")
    
    # Register agent protocols
    agent1_discovery = DiscoveryAgentProtocol(agent1.agent_id)
    agent1_communication = CommunicationAgentProtocol(agent1.agent_id)
    
    agent2_discovery = DiscoveryAgentProtocol(agent2.agent_id)
    agent2_communication = CommunicationAgentProtocol(agent2.agent_id)
    
    agent1.register_protocol(agent1_discovery)
    agent1.register_protocol(agent1_communication)
    
    agent2.register_protocol(agent2_discovery)
    agent2.register_protocol(agent2_communication)
    
    # Start agents
    agent1.start()
    agent2.start()
    
    # Join network
    agent1.join_network(network)
    agent2.join_network(network)
    
    # Advertise a service
    agent1_discovery.advertise_service(
        "data-processing",
        {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON"
        }
    )
    
    # Subscribe to topics
    agent1_communication.subscribe("requests")
    agent2_communication.subscribe("responses")
    
    # Example message exchange
    message_content = {
        "type": "greeting",
        "content": "Hello from ServiceConsumer!"
    }
    agent2_communication.send_message(agent1.agent_id, message_content)
    
    # Example service request
    request_content = {
        "type": "service-request",
        "service": "data-processing",
        "data": {"values": [1, 2, 3, 4, 5]},
        "operation": "average"
    }
    request_id = agent2_communication.send_request(agent1.agent_id, request_content)
    
    # Wait a bit to let messages be processed
    time.sleep(1)
    
    # Clean up
    agent1.stop()
    agent2.stop()
    network.stop()
    
    logger.info("Example completed successfully")

if __name__ == "__main__":
    main() 