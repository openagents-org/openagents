import requests
import logging
from typing import Optional, Dict, Any

def retrieve_network_details(network_id: str, discovery_server_url: str = "https://discovery.openagents.org") -> dict:
    """Retrieve network details from the discovery server.
    
    Args:
        network_id: ID of the network to retrieve details for
        discovery_server_url: URL of the discovery server
        
    Returns:
        dict: Network details or empty dict if not found
    """
    logger = logging.getLogger(__name__)
    
    # Ensure the URL doesn't end with a slash
    if discovery_server_url.endswith('/'):
        discovery_server_url = discovery_server_url[:-1]
    
    url = f"{discovery_server_url}/list_networks"
    
    try:
        response = requests.get(url)
        if response.status_code != 200:
            logger.error(f"Failed to retrieve networks: HTTP {response.status_code}")
            return {}
        
        data = response.json()
        
        if not data.get("success", False):
            logger.error("API returned unsuccessful response")
            return {}
        
        networks = data.get("networks", [])
        for network in networks:
            if network.get("network_profile", {}).get("network_id") == network_id:
                return network
        
        logger.warning(f"Network with ID '{network_id}' not found")
        return {}
    except Exception as e:
        logger.error(f"Error retrieving network details: {str(e)}")
        return {}
