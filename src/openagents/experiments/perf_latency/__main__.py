"""
Entry point for running the latency benchmark as a module.

This allows running the benchmark with:
    python -m openagents.experiments.perf_latency
"""

from .run_openagents_latency import main
import asyncio
import sys

if __name__ == "__main__":
    # Windows compatibility
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    sys.exit(asyncio.run(main()))

