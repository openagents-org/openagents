"""Tracking of the agent react() execution context.

The agent runner processes inbound events strictly one at a time: the next
event is not dequeued until the current react() call returns. Any primitive
that blocks inside react() waiting for another agent's reply therefore stalls
every other inbound event for that agent — and if the peer agent blocks the
same way waiting on us, both agents stall until their timeouts expire
(a bounded deadlock). The safe pattern is to send without waiting and handle
the reply as a new event in the next react() round.

This module lets blocking agent-to-agent wait primitives detect that they are
being called from inside react() and warn about it. Setting the environment
variable ``OPENAGENTS_STRICT_NO_BLOCKING_WAIT=1`` upgrades the warning to a
``BlockingWaitInReactError``.

Agent-to-mod request/response calls (e.g. project management RPCs) are not
affected: the mod runs on the network server and never blocks waiting on the
calling agent, so no wait cycle can form.
"""

import asyncio
import logging
import os
import warnings
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# Agent id of the agent currently executing react(), if any. Set by the agent
# runner around each react() call; propagates into everything react() awaits.
current_react_agent: ContextVar[Optional[str]] = ContextVar(
    "current_react_agent", default=None
)

# The asyncio task that owns the react() call. ContextVars are inherited by
# asyncio.create_task(), so a background task spawned inside react() would
# otherwise still look like it is "inside react()" after the handler returned;
# requiring the current task to match the owner confines the scope to the
# react() call itself.
current_react_task: ContextVar[Optional[object]] = ContextVar(
    "current_react_task", default=None
)

STRICT_ENV_VAR = "OPENAGENTS_STRICT_NO_BLOCKING_WAIT"


class BlockingWaitInReactError(RuntimeError):
    """Raised in strict mode when a blocking wait primitive runs inside react()."""


def _current_task() -> Optional[object]:
    try:
        return asyncio.current_task()
    except RuntimeError:
        return None


def in_react() -> bool:
    """Return True if the current coroutine is executing inside a react() call."""
    return (
        current_react_agent.get() is not None
        and current_react_task.get() is _current_task()
    )


def strict_mode_enabled() -> bool:
    return os.environ.get(STRICT_ENV_VAR, "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


@contextmanager
def react_scope(agent_id: str) -> Iterator[None]:
    """Mark the enclosed block as running inside the given agent's react()."""
    agent_token = current_react_agent.set(agent_id)
    task_token = current_react_task.set(_current_task())
    try:
        yield
    finally:
        current_react_task.reset(task_token)
        current_react_agent.reset(agent_token)


def check_blocking_wait(api_name: str, target: Optional[str] = None) -> None:
    """Warn (or raise, in strict mode) when a blocking agent-to-agent wait
    primitive is invoked from inside react().

    Args:
        api_name: Name of the blocking API, for the diagnostic message
        target: Optional peer agent / channel the caller is waiting on
    """
    if not in_react():
        return
    agent_id = current_react_agent.get()

    target_desc = f" on {target!r}" if target else ""
    message = (
        f"{api_name}{target_desc} was called inside react() of agent "
        f"{agent_id!r}. The runner processes one event at a time, so blocking "
        f"here stalls all other inbound events for this agent; if the peer "
        f"blocks the same way waiting on you, both agents deadlock until "
        f"their timeouts. Send without waiting and handle the reply as a new "
        f"event in the next react() instead. Set {STRICT_ENV_VAR}=1 to turn "
        f"this warning into an error."
    )
    if strict_mode_enabled():
        raise BlockingWaitInReactError(message)
    warnings.warn(message, DeprecationWarning, stacklevel=3)
    logger.warning(message)
