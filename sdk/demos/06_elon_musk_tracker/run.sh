#!/bin/bash
# Demo 06: Elon Musk News Tracker
# Starts both the network and the news collector agent

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Elon Musk News Tracker..."
echo "=================================="

# Start the network in the background
echo "Starting network..."
openagents launch-network "$SCRIPT_DIR/network.yaml" &
NETWORK_PID=$!

# Wait for network to be ready
sleep 3

# Start the news collector agent
echo "Starting news collector agent..."
python "$SCRIPT_DIR/agents/elon_fan_agent.py" &
AGENT_PID=$!

echo ""
echo "Network running (PID: $NETWORK_PID)"
echo "Agent running (PID: $AGENT_PID)"
echo ""
echo "MCP endpoint: http://localhost:8700/mcp"
echo "Studio UI: http://localhost:8700"
echo ""
echo "Press Ctrl+C to stop all processes"

# Handle cleanup on exit
cleanup() {
    echo ""
    echo "Stopping processes..."
    kill $AGENT_PID 2>/dev/null
    kill $NETWORK_PID 2>/dev/null
    wait
    echo "Done."
}

trap cleanup EXIT INT TERM

# Wait for processes
wait
