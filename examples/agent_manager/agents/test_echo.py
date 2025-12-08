#!/usr/bin/env python3
"""
Test Echo Agent - Simple service agent for AgentManager testing.

This agent echoes messages it receives back to the sender.
"""

import asyncio
import sys
import logging
from datetime import datetime

# Default agent ID for discovery
default_agent_id = "test_echo"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)


async def main():
    """Main agent loop."""
    logger.info(f"Echo agent '{default_agent_id}' starting...")
    
    counter = 0
    try:
        while True:
            counter += 1
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            logger.info(f"[{timestamp}] Echo agent heartbeat #{counter}")
            
            # Simulate some activity
            await asyncio.sleep(5)
            
            if counter % 3 == 0:
                print(f"Status update: Agent running for {counter * 5} seconds")
                sys.stdout.flush()
    
    except KeyboardInterrupt:
        logger.info("Echo agent shutting down gracefully...")
    except Exception as e:
        logger.error(f"Echo agent error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

