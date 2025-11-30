"""
Task scheduling utilities including cron expression parsing.

This module provides scheduling logic for recurring tasks.
"""

import time
from typing import Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class CronScheduler:
    """Simple cron expression parser and scheduler.

    Supports basic cron syntax:
    - Minute (0-59)
    - Hour (0-23)
    - Day of month (1-31)
    - Month (1-12)
    - Day of week (0-6, Sunday = 0)

    Examples:
        "*/5 * * * *" - Every 5 minutes
        "0 */2 * * *" - Every 2 hours
        "0 9 * * 1" - Every Monday at 9 AM
        "30 14 1 * *" - 2:30 PM on the 1st of every month
    """

    @staticmethod
    def parse_field(field: str, min_val: int, max_val: int) -> set:
        """Parse a single cron field into a set of valid values.

        Args:
            field: Cron field string (e.g., "*/5", "1-5", "1,3,5", "*")
            min_val: Minimum valid value
            max_val: Maximum valid value

        Returns:
            Set of integers representing valid values
        """
        if field == "*":
            return set(range(min_val, max_val + 1))

        values = set()

        # Handle comma-separated values
        for part in field.split(","):
            # Handle step values (*/5, 10-20/2)
            if "/" in part:
                range_part, step = part.split("/")
                step = int(step)

                if range_part == "*":
                    start, end = min_val, max_val
                elif "-" in range_part:
                    start, end = map(int, range_part.split("-"))
                else:
                    start = end = int(range_part)

                values.update(range(start, end + 1, step))

            # Handle ranges (10-20)
            elif "-" in part:
                start, end = map(int, part.split("-"))
                values.update(range(start, end + 1))

            # Handle single values
            else:
                values.add(int(part))

        return values

    @staticmethod
    def matches_time(cron_expr: str, dt: Optional[datetime] = None) -> bool:
        """Check if a datetime matches a cron expression.

        Args:
            cron_expr: Cron expression (5 fields)
            dt: Datetime to check (defaults to now)

        Returns:
            True if the time matches the cron expression
        """
        if dt is None:
            dt = datetime.now()

        try:
            parts = cron_expr.split()
            if len(parts) != 5:
                logger.error(f"Invalid cron expression: {cron_expr} (must have 5 fields)")
                return False

            minute_str, hour_str, day_str, month_str, dow_str = parts

            # Parse each field
            minutes = CronScheduler.parse_field(minute_str, 0, 59)
            hours = CronScheduler.parse_field(hour_str, 0, 23)
            days = CronScheduler.parse_field(day_str, 1, 31)
            months = CronScheduler.parse_field(month_str, 1, 12)
            dows = CronScheduler.parse_field(dow_str, 0, 6)

            # Check if current time matches
            return (
                dt.minute in minutes
                and dt.hour in hours
                and dt.day in days
                and dt.month in months
                and dt.weekday() % 7 in dows  # Convert Monday=0 to Sunday=0
            )

        except Exception as e:
            logger.error(f"Error parsing cron expression '{cron_expr}': {e}")
            return False

    @staticmethod
    def next_execution_time(
        cron_expr: str,
        after: Optional[datetime] = None,
        max_iterations: int = 366 * 24 * 60  # 1 year in minutes
    ) -> Optional[float]:
        """Calculate the next execution time for a cron expression.

        Args:
            cron_expr: Cron expression
            after: Calculate next time after this datetime (defaults to now)
            max_iterations: Maximum iterations to search

        Returns:
            Unix timestamp of next execution, or None if not found
        """
        if after is None:
            after = datetime.now()

        # Start from the next minute
        current = after.replace(second=0, microsecond=0) + timedelta(minutes=1)

        for _ in range(max_iterations):
            if CronScheduler.matches_time(cron_expr, current):
                return current.timestamp()
            current += timedelta(minutes=1)

        logger.warning(f"Could not find next execution time for cron expression: {cron_expr}")
        return None


class IntervalScheduler:
    """Simple interval-based scheduler."""

    @staticmethod
    def next_execution_time(
        interval_seconds: int,
        last_execution: Optional[float] = None
    ) -> float:
        """Calculate next execution time for interval-based scheduling.

        Args:
            interval_seconds: Interval in seconds
            last_execution: Unix timestamp of last execution (defaults to now)

        Returns:
            Unix timestamp of next execution
        """
        if last_execution is None:
            last_execution = time.time()

        return last_execution + interval_seconds


def calculate_next_scheduled_time(
    schedule: dict,
    last_execution: Optional[float] = None
) -> Optional[float]:
    """Calculate the next scheduled execution time based on schedule config.

    Args:
        schedule: Schedule configuration dict with 'schedule_type', 'cron_expression', 'interval_seconds'
        last_execution: Unix timestamp of last execution

    Returns:
        Unix timestamp of next scheduled execution, or None for one-time tasks
    """
    schedule_type = schedule.get("schedule_type", "one_time")

    if schedule_type == "one_time":
        # One-time tasks don't have a next scheduled time
        return None

    elif schedule_type == "cron":
        cron_expr = schedule.get("cron_expression")
        if not cron_expr:
            logger.error("Cron schedule missing 'cron_expression'")
            return None

        # Calculate next execution time
        after_dt = datetime.fromtimestamp(last_execution) if last_execution else None
        return CronScheduler.next_execution_time(cron_expr, after_dt)

    elif schedule_type == "interval":
        interval = schedule.get("interval_seconds")
        if not interval:
            logger.error("Interval schedule missing 'interval_seconds'")
            return None

        return IntervalScheduler.next_execution_time(interval, last_execution)

    else:
        logger.error(f"Unknown schedule type: {schedule_type}")
        return None
