#!/usr/bin/env python3
"""
OpenAgents Agent-to-Agent Latency Measurement

This script measures message passing latency in OpenAgents networks
as the number of agents increases, testing the framework's scalability.

Related to issue #84: Measure agent-to-agent latency vs agent count.

Usage:
    python -m openagents.experiments.perf_latency.run_openagents_latency
    
    # With custom parameters:
    python -m openagents.experiments.perf_latency.run_openagents_latency --agents 1,2,5,10,20 --iterations 20
"""

import asyncio
import json
import logging
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import argparse

from openagents.core.client import AgentClient
from openagents.core.network import AgentNetwork
from openagents.models.event import Event
from openagents.models.network_config import NetworkConfig, TransportConfigItem, TransportType, NetworkMode

# Configure logging
logging.basicConfig(
    level=logging.WARNING,  # Reduce noise during benchmarks
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class LatencyBenchmark:
    """
    Benchmark for measuring agent-to-agent message latency in OpenAgents.
    
    This class creates a test network, spawns multiple agents, and measures
    the round-trip time for ping-echo message exchanges.
    """

    def __init__(
        self,
        agent_counts: List[int],
        iterations_per_count: int = 50,
        output_dir: Optional[str] = None,
    ):
        """
        Initialize the latency benchmark.
        
        Args:
            agent_counts: List of agent counts to test (e.g., [1, 2, 5, 10, 20, 50])
            iterations_per_count: Number of ping-echo iterations per agent count
            output_dir: Directory to save results (default: current directory)
        """
        self.agent_counts = sorted(agent_counts)
        self.iterations = iterations_per_count
        self.output_dir = Path(output_dir) if output_dir else Path.cwd()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.network: Optional[AgentNetwork] = None
        self.sender_client: Optional[AgentClient] = None
        self.receiver_clients: List[AgentClient] = []
        
        self.results: Dict = {
            "metadata": {
                "timestamp": datetime.now().isoformat(),
                "iterations_per_count": iterations_per_count,
                "agent_counts": agent_counts,
            },
            "measurements": []
        }

    async def setup_network(self) -> None:
        """
        Set up the test - connects to existing network instead of creating one.
        
        Assumes an OpenAgents network is already running on localhost.
        """
        logger.info("Connecting to existing network...")
        
        # No need to create network - we'll connect agents directly to existing one
        # The existing network is running on:
        # - HTTP: 0.0.0.0:8700
        # - gRPC: 0.0.0.0:8600
        
        logger.info("✅ Ready to connect agents to existing network")
        
        # Wait a moment
        await asyncio.sleep(0.5)

    async def create_sender_agent(self) -> None:
        """
        Create the sender agent that will send ping messages.
        """
        logger.info("Creating sender agent...")
        
        self.sender_client = AgentClient(
            agent_id="sender",
        )
        
        # Connect to the existing network (HTTP transport)
        connected = await self.sender_client.connect_to_server(
            network_host="127.0.0.1",
            network_port=8700,  # HTTP port of existing network
        )
        
        if not connected:
            raise RuntimeError("Failed to connect sender agent")
        
        logger.info("✅ Sender agent connected")
        await asyncio.sleep(0.5)

    async def create_receiver_agents(self, count: int) -> None:
        """
        Create N receiver agents that will echo messages back.
        
        Args:
            count: Number of receiver agents to create
        """
        logger.info(f"Creating {count} receiver agent(s)...")
        
        # Clean up any existing receivers
        await self.cleanup_receivers()
        
        self.receiver_clients = []
        
        for i in range(count):
            client = AgentClient(
                agent_id=f"receiver_{i}",
            )
            
            # Connect to existing network (HTTP transport)
            connected = await client.connect_to_server(
                network_host="127.0.0.1",
                network_port=8700,  # HTTP port of existing network
            )
            
            if not connected:
                raise RuntimeError(f"Failed to connect receiver_{i}")
            
            # Set up echo handler for this receiver
            self._setup_echo_handler(client)
            
            self.receiver_clients.append(client)
            await asyncio.sleep(0.1)  # Small delay between connections
        
        logger.info(f"✅ Created {count} receiver agent(s)")
        
        # Wait for all agents to be fully registered
        await asyncio.sleep(1)

    def _setup_echo_handler(self, client: AgentClient) -> None:
        """
        Set up message handler to echo back ping messages.
        
        Args:
            client: The receiver agent client
        """
        async def echo_handler(event: Event):
            """Handler that echoes ping messages back as pong."""
            if event.event_name == "benchmark.ping":
                # Create pong response
                pong_event = Event(
                    event_name="benchmark.pong",
                    source_id=client.agent_id,
                    destination_id=event.source_id,
                    payload={
                        "echo_time": time.time(),
                        "original_time": event.payload.get("time"),
                        "iteration": event.payload.get("iteration"),
                    },
                )
                # Send pong back
                await client.send_event(pong_event)
        
        # Register handler using the correct AgentClient API
        client.register_event_handler(echo_handler, ["benchmark.ping"])

    async def measure_latency_for_count(self, agent_count: int) -> Dict:
        """
        Measure latency for a specific number of agents.
        
        Args:
            agent_count: Number of receiver agents to test with
            
        Returns:
            Dict containing latency statistics for this agent count
        """
        print(f"\n{'=' * 60}")
        print(f"Testing with {agent_count} agent(s)")
        print(f"{'=' * 60}")
        
        # Create receiver agents
        await self.create_receiver_agents(agent_count)
        
        latencies: List[float] = []
        pong_responses: List[Dict] = []
        send_times: Dict[int, float] = {}
        
        # Set up pong handler for sender to capture responses
        async def pong_handler(event: Event):
            """Handler that captures pong responses."""
            if event.event_name == "benchmark.pong":
                iteration = event.payload.get("iteration")
                receive_time = time.time()
                pong_responses.append({
                    "iteration": iteration,
                    "receive_time": receive_time,
                    "send_time": send_times.get(iteration),
                })
        
        # Register pong handler
        self.sender_client.register_event_handler(pong_handler, ["benchmark.pong"])
        
        # Perform ping-pong iterations
        for iteration in range(self.iterations):
            # Pick a receiver (round-robin)
            target_receiver = self.receiver_clients[iteration % agent_count]
            
            # Record send time
            send_time = time.time()
            send_times[iteration] = send_time
            
            # Create ping event
            ping_event = Event(
                event_name="benchmark.ping",
                source_id=self.sender_client.agent_id,
                destination_id=target_receiver.agent_id,
                payload={
                    "time": send_time,
                    "iteration": iteration,
                },
            )
            
            # Send ping
            await self.sender_client.send_event(ping_event)
            
            # Small delay between iterations to avoid overwhelming the network
            await asyncio.sleep(0.01)
        
        # Wait for all pong responses (with timeout)
        print(f"  Waiting for pong responses...")
        max_wait = 10  # seconds
        wait_start = time.time()
        
        while len(pong_responses) < self.iterations and (time.time() - wait_start) < max_wait:
            await asyncio.sleep(0.5)
            if len(pong_responses) > 0 and (len(pong_responses) % 10 == 0):
                print(f"  Received: {len(pong_responses)}/{self.iterations} responses")
        
        # Calculate latencies from collected responses
        for response in pong_responses:
            if response["send_time"] is not None:
                rtt = (response["receive_time"] - response["send_time"]) * 1000  # Convert to ms
                latencies.append(rtt)
        
        if len(pong_responses) < self.iterations:
            logger.warning(f"Only received {len(pong_responses)}/{self.iterations} pong responses")
        
        # Calculate statistics
        if latencies:
            stats = {
                "agent_count": agent_count,
                "successful_iterations": len(latencies),
                "failed_iterations": self.iterations - len(latencies),
                "avg_latency_ms": statistics.mean(latencies),
                "median_latency_ms": statistics.median(latencies),
                "stdev_latency_ms": statistics.stdev(latencies) if len(latencies) > 1 else 0,
                "min_latency_ms": min(latencies),
                "max_latency_ms": max(latencies),
                "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 0 else 0,
                "p99_latency_ms": sorted(latencies)[int(len(latencies) * 0.99)] if len(latencies) > 0 else 0,
            }
            
            print(f"\n📊 Results for {agent_count} agent(s):")
            print(f"  ✅ Successful: {stats['successful_iterations']}/{self.iterations}")
            print(f"  📈 Average latency: {stats['avg_latency_ms']:.2f} ms")
            print(f"  📊 Median latency: {stats['median_latency_ms']:.2f} ms")
            print(f"  📏 Std deviation: {stats['stdev_latency_ms']:.2f} ms")
            print(f"  ⬇️  Min latency: {stats['min_latency_ms']:.2f} ms")
            print(f"  ⬆️  Max latency: {stats['max_latency_ms']:.2f} ms")
            print(f"  📐 P95 latency: {stats['p95_latency_ms']:.2f} ms")
            print(f"  📐 P99 latency: {stats['p99_latency_ms']:.2f} ms")
        else:
            stats = {
                "agent_count": agent_count,
                "successful_iterations": 0,
                "failed_iterations": self.iterations,
                "avg_latency_ms": 0,
                "median_latency_ms": 0,
                "stdev_latency_ms": 0,
                "min_latency_ms": 0,
                "max_latency_ms": 0,
                "p95_latency_ms": 0,
                "p99_latency_ms": 0,
            }
            print(f"\n❌ No successful measurements for {agent_count} agent(s)")
        
        return stats

    async def run_benchmark(self) -> None:
        """
        Run the complete benchmark across all agent counts.
        """
        print("\n" + "=" * 60)
        print("OpenAgents Agent-to-Agent Latency Benchmark")
        print("=" * 60)
        print(f"Testing agent counts: {self.agent_counts}")
        print(f"Iterations per count: {self.iterations}")
        print("\n⚠️  Prerequisites: An OpenAgents network must be running!")
        print("   Start with: openagents network start ./my_first_network")
        print("   Connecting to: localhost:8700 (HTTP)")
        print("=" * 60)
        
        try:
            # Setup (just preparation, doesn't create network)
            await self.setup_network()
            
            # Create sender - this will fail with clear error if network isn't running
            await self.create_sender_agent()
            
            # Test each agent count
            for agent_count in self.agent_counts:
                stats = await self.measure_latency_for_count(agent_count)
                self.results["measurements"].append(stats)
            
            # Save results
            self.save_results()
            
            # Print summary
            self.print_summary()
            
        except Exception as e:
            logger.error(f"Benchmark failed: {e}", exc_info=True)
            raise
        finally:
            await self.cleanup()

    def save_results(self) -> None:
        """Save benchmark results to JSON file."""
        output_file = self.output_dir / f"latency_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(output_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print(f"\n💾 Results saved to: {output_file}")

    def print_summary(self) -> None:
        """Print summary table of all results."""
        print("\n" + "=" * 60)
        print("Summary: Latency vs Agent Count")
        print("=" * 60)
        print(f"{'Agents':<10} {'Avg (ms)':<12} {'Median (ms)':<12} {'Std Dev (ms)':<12} {'P95 (ms)':<10}")
        print("-" * 60)
        
        for measurement in self.results["measurements"]:
            print(
                f"{measurement['agent_count']:<10} "
                f"{measurement['avg_latency_ms']:<12.2f} "
                f"{measurement['median_latency_ms']:<12.2f} "
                f"{measurement['stdev_latency_ms']:<12.2f} "
                f"{measurement['p95_latency_ms']:<10.2f}"
            )
        
        print("=" * 60)

    async def cleanup_receivers(self) -> None:
        """Clean up receiver agents."""
        for client in self.receiver_clients:
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting receiver: {e}")
        
        self.receiver_clients = []
        await asyncio.sleep(0.5)

    async def cleanup(self) -> None:
        """Clean up all resources."""
        logger.info("Cleaning up resources...")
        
        # Disconnect sender
        if self.sender_client:
            try:
                await self.sender_client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting sender: {e}")
        
        # Disconnect all receivers
        await self.cleanup_receivers()
        
        # Note: We don't shutdown the network since we're using an existing one
        # The user's network continues running after the benchmark
        
        logger.info("✅ Cleanup completed (network remains running)")


async def main():
    """Main entry point for the benchmark script.
    
    Prerequisites:
        An OpenAgents network must be running before starting the benchmark.
        
        Start a network with:
            openagents network start ./my_first_network
        
        The benchmark will connect to:
            - HTTP: localhost:8700 (default)
            - gRPC: localhost:8600 (if HTTP fails)
    """
    parser = argparse.ArgumentParser(
        description="Measure agent-to-agent latency in OpenAgents networks. "
                    "Requires an existing network running on localhost:8700 (HTTP) or localhost:8600 (gRPC).",
        epilog="Example: First start a network with 'openagents network start ./my_first_network', "
               "then run this benchmark."
    )
    parser.add_argument(
        "--agents",
        type=str,
        default="1,2,5,10,20,50",
        help="Comma-separated list of agent counts to test (default: 1,2,5,10,20,50)"
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=50,
        help="Number of ping-echo iterations per agent count (default: 50)"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Directory to save results (default: current directory)"
    )
    
    args = parser.parse_args()
    
    # Parse agent counts
    agent_counts = [int(x.strip()) for x in args.agents.split(",")]
    
    # Create and run benchmark
    benchmark = LatencyBenchmark(
        agent_counts=agent_counts,
        iterations_per_count=args.iterations,
        output_dir=args.output_dir,
    )
    
    try:
        await benchmark.run_benchmark()
        print("\n✅ Benchmark completed successfully!")
        return 0
    except KeyboardInterrupt:
        print("\n\n⚠️  Benchmark interrupted by user")
        await benchmark.cleanup()
        return 1
    except Exception as e:
        print(f"\n❌ Benchmark failed: {e}")
        return 1


if __name__ == "__main__":
    # Windows compatibility
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    sys.exit(asyncio.run(main()))

