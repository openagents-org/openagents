import requests
import logging
from typing import Optional, Dict, Any

from openagents.config.globals import OPENAGENTS_DISCOVERY_SERVER_URL


def retrieve_network_details(
    network_id: str, discovery_server_url: str = OPENAGENTS_DISCOVERY_SERVER_URL
) -> dict:
    """Retrieve network details from the discovery server.

    Args:
        network_id: ID of the network to retrieve details for
        discovery_server_url: URL of the discovery server

    Returns:
        dict: Network details or empty dict if not found
    """
    logger = logging.getLogger(__name__)

    # Ensure the URL doesn't end with a slash
    if discovery_server_url.endswith("/"):
        discovery_server_url = discovery_server_url[:-1]

    url = f"{discovery_server_url}/networks/{network_id}"

    try:
        response = requests.get(url)
        if response.status_code != 200:
            logger.error(f"Failed to retrieve network: HTTP {response.status_code}")
            return {}

        data = response.json()

        # The example response places the info in "data"
        if "data" not in data:
            logger.error("No 'data' field found in discovery server response.")
            return {}

        network = data["data"]

        # The "profile" field within data is the network_profile
        # For compatibility with existing consumers, return a dict
        # with network_profile, status, stats etc as top-level
        network_details = {
            "network_profile": network.get("profile", {}),
            "status": network.get("status"),
            "stats": network.get("stats"),
            "org": network.get("org"),
            "org_id": network.get("org_id"),
            "createdAt": network.get("createdAt"),
            "updatedAt": network.get("updatedAt"),
        }

        # Also include the top-level id for compatibility
        network_details["network_profile"]["network_id"] = network.get("id", network_id)

        return network_details

    except Exception as e:
        logger.error(f"Error retrieving network details: {str(e)}")
        return {}
