#!/bin/bash

# Thread Messaging Network Startup Script
# This script helps launch the network and agents for the example

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENAGENTS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🌐 Thread Messaging Network Example"
echo "=================================="
echo "Script directory: $SCRIPT_DIR"
echo "OpenAgents root: $OPENAGENTS_ROOT"
echo

# Check if openagents command is available
if ! command -v openagents &> /dev/null; then
    echo "❌ openagents command not found. Please install OpenAgents first:"
    echo "   cd $OPENAGENTS_ROOT"
    echo "   pip install -e ."
    exit 1
fi

# Function to check if network is running
check_network() {
    # Check if openagents process is running
    if pgrep -f "openagents launch-network" > /dev/null 2>&1; then
        return 0  # Network is running
    else
        return 1  # Network is not running
    fi
}

# Function to start the network
start_network() {
    echo "🚀 Starting Thread Messaging Network..."
    cd "$SCRIPT_DIR"
    
    # Start network in background
    openagents launch-network network_config.yaml &
    NETWORK_PID=$!
    echo "Network PID: $NETWORK_PID"
    
    # Wait for network to be ready
    echo "⏳ Waiting for network to start..."
    for i in {1..30}; do
        if check_network; then
            echo "✅ Network is ready on port 8571"
            return 0
        fi
        sleep 1
        echo -n "."
    done
    
    echo
    echo "❌ Network failed to start within 30 seconds"
    kill $NETWORK_PID 2>/dev/null || true
    exit 1
}

# Function to stop the network
stop_network() {
    echo "🛑 Stopping network..."
    pkill -f "openagents launch-network" || true
    sleep 2
    
    if check_network; then
        echo "⚠️  Network still running, force killing..."
        lsof -ti :8571 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    if ! check_network; then
        echo "✅ Network stopped"
    else
        echo "❌ Failed to stop network"
    fi
}

# Function to run the interactive example
run_interactive() {
    echo "🎮 Starting interactive example..."
    cd "$SCRIPT_DIR"
    python run_example.py
}

# Function to run the full demo
run_demo() {
    echo "🎭 Starting full demo..."
    cd "$SCRIPT_DIR"
    python demo_script.py
}

# Function to show status
show_status() {
    echo "📊 Network Status"
    echo "================"
    
    if check_network; then
        echo "✅ Network: Running on port 8571"
        echo "📈 Process info:"
        pgrep -f "openagents launch-network" | head -5 | while read pid; do
            echo "   PID $pid: $(ps -p $pid -o comm= 2>/dev/null || echo 'process')"
        done
    else
        echo "❌ Network: Not running"
    fi
    
    echo
    echo "📁 Files:"
    ls -la "$SCRIPT_DIR" | grep -E "\.(yaml|py|md|sh)$" | awk '{print "   " $9 " (" $5 " bytes)"}'
    
    echo
    echo "🔍 Logs:"
    if [[ -f "$SCRIPT_DIR/thread_messaging_network.log" ]]; then
        echo "   thread_messaging_network.log ($(wc -l < "$SCRIPT_DIR/thread_messaging_network.log") lines)"
    else
        echo "   No log files found"
    fi
}

# Main script logic
case "${1:-help}" in
    start)
        if check_network; then
            echo "⚠️  Network already running on port 8571"
            echo "Use 'stop' to stop it first, or 'status' to check"
        else
            start_network
        fi
        ;;
    
    stop)
        stop_network
        ;;
    
    restart)
        stop_network
        sleep 2
        start_network
        ;;
    
    interactive)
        if ! check_network; then
            echo "❌ Network not running. Starting it first..."
            start_network
            sleep 2
        fi
        run_interactive
        ;;
    
    demo)
        if ! check_network; then
            echo "❌ Network not running. Starting it first..."
            start_network
            echo "⏳ Giving network extra time to fully initialize..."
            sleep 5
        fi
        run_demo
        ;;
    
    status)
        show_status
        ;;
    
    clean)
        echo "🧹 Cleaning up..."
        stop_network
        rm -f "$SCRIPT_DIR"/*.log
        rm -f "$SCRIPT_DIR"/sample_*.txt
        rm -f "$SCRIPT_DIR"/threading_design.md
        rm -f "$SCRIPT_DIR"/test_plan.json
        rm -rf "$SCRIPT_DIR"/network_files
        rm -rf "$SCRIPT_DIR"/*_files
        echo "✅ Cleanup complete"
        ;;
    
    help|*)
        echo "Usage: $0 <command>"
        echo
        echo "Commands:"
        echo "  start       - Start the Thread Messaging Network"
        echo "  stop        - Stop the network"
        echo "  restart     - Restart the network"
        echo "  interactive - Run interactive example (starts network if needed)"
        echo "  demo        - Run full demo script (starts network if needed)"
        echo "  status      - Show network and file status"
        echo "  clean       - Stop network and clean up files"
        echo "  help        - Show this help message"
        echo
        echo "Examples:"
        echo "  $0 interactive    # Quick start for manual testing"
        echo "  $0 demo          # Full automated demonstration"
        echo "  $0 start         # Just start the network"
        echo "  $0 status        # Check what's running"
        ;;
esac
