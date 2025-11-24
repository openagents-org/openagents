#!/bin/bash
set -e

echo "🚀 Starting OpenAgents Network + Studio..."

# Function to handle shutdown gracefully
cleanup() {
    echo "🛑 Shutting down services..."
    kill $NETWORK_PID $STUDIO_PID 2>/dev/null || true
    wait $NETWORK_PID $STUDIO_PID 2>/dev/null || true
    echo "✅ Services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Start the OpenAgents Network in the background
echo "🌐 Starting OpenAgents Network on ports 8700 (HTTP) and 8600 (gRPC)..."
openagents network start /network &
NETWORK_PID=$!

# Wait for network to be ready
echo "⏳ Waiting for network to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8700/health > /dev/null 2>&1; then
        echo "✅ Network is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Network failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Start the Studio web interface
echo "🎨 Starting OpenAgents Studio on port 8050..."
cd /app/studio/build && serve -s . -l 8050 &
STUDIO_PID=$!

echo "✅ All services started successfully!"
echo ""
echo "📍 Access points:"
echo "   - Studio Web UI: http://localhost:8050"
echo "   - Network HTTP API: http://localhost:8700"
echo "   - Network gRPC: localhost:8600"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for any process to exit
wait -n $NETWORK_PID $STUDIO_PID

# Exit with status of process that exited first
exit $?
