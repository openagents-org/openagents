import logging
import time
from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery.agent_registration.network_protocol import AgentRegistrationNetworkProtocol
from openagents.protocols.discovery.agent_registration.agent_protocol import AgentRegistrationAgentProtocol
from openagents.protocols.discovery.discoverability.network_protocol import DiscoverabilityNetworkProtocol
from openagents.protocols.discovery.discoverability.agent_protocol import DiscoverabilityAgentProtocol
from openagents.protocols.communication.messaging.network_protocol import MessagingNetworkProtocol
from openagents.protocols.communication.messaging.agent_protocol import MessagingAgentProtocol

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
    registration_protocol = AgentRegistrationNetworkProtocol()
    discoverability_protocol = DiscoverabilityNetworkProtocol()
    messaging_protocol = MessagingNetworkProtocol()
    
    network.register_protocol(registration_protocol)
    network.register_protocol(discoverability_protocol)
    network.register_protocol(messaging_protocol)
    
    # Start the network
    network.start()
    logger.info(f"Network {network.network_id} started")
    
    # Create agents
    agent1 = Agent(name="ServiceProvider")
    agent2 = Agent(name="ServiceConsumer")
    
    # Register agent protocols
    agent1_registration = AgentRegistrationAgentProtocol(agent1.agent_id)
    agent1_discoverability = DiscoverabilityAgentProtocol(agent1.agent_id)
    agent1_messaging = MessagingAgentProtocol(agent1.agent_id)
    
    agent2_registration = AgentRegistrationAgentProtocol(agent2.agent_id)
    agent2_discoverability = DiscoverabilityAgentProtocol(agent2.agent_id)
    agent2_messaging = MessagingAgentProtocol(agent2.agent_id)
    
    agent1.register_protocol(agent1_registration)
    agent1.register_protocol(agent1_discoverability)
    agent1.register_protocol(agent1_messaging)
    
    agent2.register_protocol(agent2_registration)
    agent2.register_protocol(agent2_discoverability)
    agent2.register_protocol(agent2_messaging)
    
    # Start agents
    agent1.start()
    agent2.start()
    
    # Join network
    agent1.join_network(network)
    agent2.join_network(network)
    
    # Register agents with the network
    agent1_registration.register()
    agent2_registration.register()
    
    # Advertise a service
    agent1_discoverability.advertise_service(
        "data-processing",
        {
            "description": "Process data using advanced algorithms",
            "input_format": "JSON",
            "output_format": "JSON"
        }
    )
    
    # Set up message handlers
    def handle_greeting(sender_id, msg_type, content):
        logger.info(f"Agent {agent1.agent_id} received greeting: {content}")
        # Send a response
        agent1_messaging.send_message(
            sender_id, 
            "greeting-response", 
            {"message": f"Hello back from {agent1.agent_id}!"}
        )
        return True
    
    def handle_service_request(sender_id, msg_type, content):
        logger.info(f"Agent {agent1.agent_id} received service request: {content}")
        
        # Process the request
        if content.get("service") == "data-processing" and content.get("operation") == "average":
            values = content.get("data", {}).get("values", [])
            if values:
                result = sum(values) / len(values)
                # Send response
                agent1_messaging.send_message(
                    sender_id,
                    "service-response",
                    {
                        "request_id": content.get("request_id"),
                        "result": result
                    }
                )
                return True
        
        return False
    
    # Register message handlers
    agent1_messaging.register_message_handler("greeting", handle_greeting)
    agent1_messaging.register_message_handler("service-request", handle_service_request)
    
    # Example message exchange
    logger.info("Sending greeting message...")
    agent2_messaging.send_message(
        agent1.agent_id, 
        "greeting", 
        {"message": "Hello from ServiceConsumer!"}
    )
    
    # Wait a bit to let messages be processed
    time.sleep(0.5)
    
    # Example service request
    logger.info("Sending service request...")
    agent2_messaging.send_message(
        agent1.agent_id,
        "service-request",
        {
            "request_id": "req-001",
            "service": "data-processing",
            "data": {"values": [1, 2, 3, 4, 5]},
            "operation": "average"
        }
    )
    
    # Wait a bit to let messages be processed
    time.sleep(0.5)
    
    # Clean up
    logger.info("Cleaning up...")
    agent1_registration.unregister()
    agent2_registration.unregister()
    
    agent1.leave_network()
    agent2.leave_network()
    
    agent1.stop()
    agent2.stop()
    network.stop()
    
    logger.info("Example completed successfully")

if __name__ == "__main__":
    main() 