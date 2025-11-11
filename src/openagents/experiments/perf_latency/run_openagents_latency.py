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
from openagents.models.network_config import (
    NetworkConfig,
    NetworkMode,
    TransportConfigItem,
)

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
        Set up the test network using OpenAgents framework.
        
        Creates a centralized network with HTTP transport for testing.
        """
        logger.info("Setting up test network...")
        
        # Create minimal network configuration for testing
        config = NetworkConfig(
            name="latency-benchmark-network",
            node_id="benchmark-network",
            mode=NetworkMode.CENTRALIZED,
            transports=[
                TransportConfigItem(
                    type="http",
                    host="127.0.0.1",
                    port=9570,  # Use different port to avoid conflicts
                    enabled=True
                )
            ],
        )
        
        # Create network with temporary workspace
        self.network = AgentNetwork(config, workspace_path=None)
        
        # Initialize network
        initialized = await self.network.initialize()
        if not initialized:
            raise RuntimeError("Failed to initialize network")
        
        # Start network transports
        await self.network.start()
        
        logger.info("✅ Network started successfully on port 9570")
        
        # Wait for network to be fully ready
        await asyncio.sleep(1)

    async def create_sender_agent(self) -> None:
        """
        Create the sender agent that will send ping messages.
        """
        logger.info("Creating sender agent...")
        
        self.sender_client = AgentClient(
            agent_id="sender",
            secret="sender-secret",
        )
        
        # Connect to the test network
        connected = await self.sender_client.connect(
            network_host="127.0.0.1",
            network_port=9570,
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
                secret=f"receiver-{i}-secret",
            )
            
            # Connect to network
            connected = await client.connect(
                network_host="127.0.0.1",
                network_port=9570,
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
        
        # Register handler
        if client.connector:
            client.connector.register_message_handler("direct_message", echo_handler)

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
        
        # Perform ping-pong iterations
        for iteration in range(self.iterations):
            # Pick a receiver (round-robin)
            target_receiver = self.receiver_clients[iteration % agent_count]
            
            # Record send time
            send_time = time.time()
            
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
            
            # Wait for pong response
            try:
                def is_pong_response(event: Event) -> bool:
                    return (
                        event.event_name == "benchmark.pong" and
                        event.payload.get("iteration") == iteration
                    )
                
                pong_event = await self.sender_client.wait_event(
                    condition=is_pong_response,
                    timeout=5.0
                )
                
                if pong_event:
                    receive_time = time.time()
                    rtt = (receive_time - send_time) * 1000  # Convert to ms
                    latencies.append(rtt)
                    
                    if (iteration + 1) % 10 == 0:
                        print(f"  Progress: {iteration + 1}/{self.iterations} iterations")
                else:
                    logger.warning(f"Timeout waiting for pong (iteration {iteration})")
                    
            except Exception as e:
                logger.error(f"Error in iteration {iteration}: {e}")
            
            # Small delay between iterations to avoid overwhelming the network
            await asyncio.sleep(0.01)
        
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
        print("=" * 60)
        
        try:
            # Setup network
            await self.setup_network()
            
            # Create sender
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
        
        # Shutdown network
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down network: {e}")
        
        logger.info("✅ Cleanup completed")


async def main():
    """Main entry point for the benchmark script."""
    parser = argparse.ArgumentParser(
        description="Measure agent-to-agent latency in OpenAgents networks"
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

