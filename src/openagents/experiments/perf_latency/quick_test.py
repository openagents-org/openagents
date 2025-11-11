#!/usr/bin/env python3
"""
Quick Test for Latency Benchmark

This is a minimal test to verify the benchmark works correctly
before running full-scale experiments.

Usage:
    python -m openagents.experiments.perf_latency.quick_test
"""

import asyncio
import sys

from .run_openagents_latency import LatencyBenchmark


async def main():
    """Run a quick test with minimal agent counts."""
    print("🧪 Running quick test of latency benchmark...")
    print("   Testing with 1 and 2 agents, 10 iterations each")
    print()
    
    benchmark = LatencyBenchmark(
        agent_counts=[1, 2],
        iterations_per_count=10,
        output_dir="./test_results"
    )
    
    try:
        await benchmark.run_benchmark()
        print("\n✅ Quick test passed!")
        print("\n💡 Next steps:")
        print("   1. Review the test_results/ directory")
        print("   2. Run the full benchmark:")
        print("      python -m openagents.experiments.perf_latency.run_openagents_latency")
        print("   3. Plot the results:")
        print("      python -m openagents.experiments.perf_latency.plot_latency")
        return 0
    except Exception as e:
        print(f"\n❌ Quick test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    sys.exit(asyncio.run(main()))

