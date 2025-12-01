"""
Test cases for the network discovery functionality.

This module contains tests for the discover_running_networks function
used by the `openagents network list --status` command.
"""

import pytest
from unittest.mock import patch, MagicMock

from openagents.cli import discover_running_networks


class TestDiscoverRunningNetworks:
    """Tests for the discover_running_networks function."""

    def test_discover_no_networks_running(self):
        """Test discovery when no networks are running."""
        # Use a port that's unlikely to be in use
        networks = discover_running_networks(
            ports=[59999, 59998],
            hosts=["127.0.0.1"],
            timeout=0.5
        )
        assert networks == []

    def test_discover_with_mock_network(self):
        """Test discovery with a mocked network response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "network_id": "test-network-1",
                "network_name": "TestNetwork",
                "is_running": True,
                "uptime_seconds": 100.5,
                "agent_count": 3,
                "network_profile": {
                    "description": "A test network"
                }
            }
        }

        with patch('requests.get', return_value=mock_response):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost"],
                timeout=1.0
            )

        assert len(networks) == 1
        assert networks[0]["network_id"] == "test-network-1"
        assert networks[0]["network_name"] == "TestNetwork"
        assert networks[0]["is_running"] is True
        assert networks[0]["port"] == 8700
        assert networks[0]["agent_count"] == 3

    def test_discover_skips_non_openagents_response(self):
        """Test that non-OpenAgents responses are skipped."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "ok",  # Not an OpenAgents response format
        }

        with patch('requests.get', return_value=mock_response):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost"],
                timeout=1.0
            )

        assert networks == []

    def test_discover_handles_connection_error(self):
        """Test that connection errors are handled gracefully."""
        import requests
        
        with patch('requests.get', side_effect=requests.exceptions.ConnectionError()):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost"],
                timeout=1.0
            )

        assert networks == []

    def test_discover_handles_timeout(self):
        """Test that timeouts are handled gracefully."""
        import requests
        
        with patch('requests.get', side_effect=requests.exceptions.Timeout()):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost"],
                timeout=1.0
            )

        assert networks == []

    def test_discover_deduplicates_networks(self):
        """Test that the same network found on different hosts is deduplicated."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "network_id": "duplicate-network",
                "network_name": "DuplicateNetwork",
                "is_running": True,
                "uptime_seconds": 50.0,
                "agent_count": 1,
            }
        }

        with patch('requests.get', return_value=mock_response):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost", "127.0.0.1"],  # Same network, different hosts
                timeout=1.0
            )

        # Should only return one network even though it was found on two hosts
        assert len(networks) == 1
        assert networks[0]["network_id"] == "duplicate-network"

    def test_discover_multiple_networks(self):
        """Test discovery of multiple networks on different ports."""
        responses = [
            {
                "success": True,
                "data": {
                    "network_id": "network-1",
                    "network_name": "Network1",
                    "is_running": True,
                    "uptime_seconds": 100.0,
                    "agent_count": 2,
                }
            },
            {
                "success": True,
                "data": {
                    "network_id": "network-2",
                    "network_name": "Network2",
                    "is_running": True,
                    "uptime_seconds": 200.0,
                    "agent_count": 5,
                }
            }
        ]
        
        call_count = [0]
        
        def mock_get(url, **kwargs):
            response = MagicMock()
            response.status_code = 200
            # Return different networks for different ports
            idx = call_count[0] % 2
            response.json.return_value = responses[idx]
            call_count[0] += 1
            return response

        with patch('requests.get', side_effect=mock_get):
            networks = discover_running_networks(
                ports=[8700, 8701],
                hosts=["localhost"],
                timeout=1.0
            )

        assert len(networks) == 2
        network_ids = {n["network_id"] for n in networks}
        assert "network-1" in network_ids
        assert "network-2" in network_ids

    def test_discover_with_default_ports(self):
        """Test discovery uses reasonable default ports."""
        import requests
        
        with patch('requests.get', side_effect=requests.exceptions.ConnectionError("No network")):
            # Just verify it runs without error using defaults
            networks = discover_running_networks(timeout=0.1)
        
        assert networks == []

    def test_discover_http_error_response(self):
        """Test that HTTP error responses are handled."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch('requests.get', return_value=mock_response):
            networks = discover_running_networks(
                ports=[8700],
                hosts=["localhost"],
                timeout=1.0
            )

        assert networks == []
