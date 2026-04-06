#!/usr/bin/env python3
"""
Test Logger Agent - Generates various types of log output for testing.

This agent produces different types of logs (info, warning, error) and
writes to both stdout and stderr for log capture testing.
"""

import asyncio
import sys
import logging
import random
from datetime import datetime

# Default agent ID for discovery
default_agent_id = "test_logger"

# Setup logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)


async def main():
    """Main agent loop."""
    logger.info(f"Logger agent '{default_agent_id}' starting...")
    logger.info("This agent will generate various types of log output")
    
    counter = 0
    log_types = ["info", "info", "info", "warning", "error", "debug"]
    
    try:
        while True:
            counter += 1
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # Random log type
            log_type = random.choice(log_types)
            
            if log_type == "info":
                logger.info(f"[#{counter}] Normal operation - all systems running")
            elif log_type == "warning":
                logger.warning(f"[#{counter}] Test warning - simulated minor issue")
            elif log_type == "error":
                logger.error(f"[#{counter}] Test error - simulated failure")
                print(f"[STDERR] Error details for event #{counter}", file=sys.stderr)
                sys.stderr.flush()
            elif log_type == "debug":
                logger.debug(f"[#{counter}] Debug information - detailed status")
            
            # Occasional status report to stdout
            if counter % 10 == 0:
                print(f"\n{'='*50}")
                print(f"Status Report #{counter//10}")
                print(f"Time: {timestamp}")
                print(f"Events logged: {counter}")
                print(f"{'='*50}\n")
                sys.stdout.flush()
            
            await asyncio.sleep(3)
    
    except KeyboardInterrupt:
        logger.info("Logger agent shutting down gracefully...")
    except Exception as e:
        logger.error(f"Logger agent error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

