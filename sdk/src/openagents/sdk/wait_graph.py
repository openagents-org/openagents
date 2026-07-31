"""Server-side wait-for graph deadlock detection.

Every event in a network flows through the central event gateway, which makes
the server the natural place to watch for agents waiting on each other. An
event sent with ``requires_response=True`` from agent A to agent B registers a
directed wait edge A -> B keyed by the request's event id; an event whose
``response_to`` references that request clears the edge. If adding an edge
closes a cycle (A waits on B while B — directly or transitively — waits on A),
every agent on the cycle is notified with an ``agent.wait.deadlock_detected``
event so its waiter can fail fast with the cycle path instead of blocking
until its timeout with no explanation.

This catches the wait cycles that delegation-chain validation cannot see:
mutual ``send_and_wait`` calls, independent tasks pointing at each other, and
mixed-mechanism cycles.

Edges expire after a TTL so that abandoned waits (client crash, timeout
without a response event) cannot poison the graph forever.
"""

import logging
import time
from typing import Awaitable, Callable, Dict, List, Optional

from openagents.models.event import Event

logger = logging.getLogger(__name__)

DEADLOCK_EVENT_NAME = "agent.wait.deadlock_detected"

# Client-side blocking waits default to 30s; keep edges a bit longer so slow
# responses still clear them, but abandoned waits eventually vanish.
DEFAULT_EDGE_TTL_SECONDS = 60.0


class _WaitEdge:
    __slots__ = ("request_id", "waiter", "target", "expires_at")

    def __init__(self, request_id: str, waiter: str, target: str, expires_at: float):
        self.request_id = request_id
        self.waiter = waiter
        self.target = target
        self.expires_at = expires_at


class WaitGraphMonitor:
    """Observes gateway traffic and detects request/response wait cycles."""

    def __init__(
        self,
        network_id: str,
        deliver: Callable[[Event], Awaitable[None]],
        edge_ttl_seconds: float = DEFAULT_EDGE_TTL_SECONDS,
    ):
        """Initialize the monitor.

        Args:
            network_id: Used as source_id of deadlock notifications
            deliver: Coroutine used to deliver a notification event to its
                destination agent (the gateway's deliver_event)
            edge_ttl_seconds: How long an unanswered wait edge is kept
        """
        self._network_id = network_id
        self._deliver = deliver
        self._edge_ttl = edge_ttl_seconds
        # request_id -> edge; the wait graph adjacency is derived on demand
        self._edges: Dict[str, _WaitEdge] = {}

    async def observe(self, event: Event) -> None:
        """Update the wait graph from one event and report any new cycle."""
        self._purge_expired()

        # A response clears the wait it answers, whatever event carries it
        # (the original reply or a mod relay of it).
        if event.response_to:
            self._edges.pop(event.response_to, None)
            return

        if not event.requires_response:
            return

        waiter = event.source_id
        target = event.destination_id
        if not self._is_agent_to_agent(waiter, target):
            return

        # Mod relays (…​.notification) duplicate the original request with a
        # fresh event id; the reply's response_to references the original, so
        # a relay edge would never be cleared. Track the original only.
        if event.event_name.endswith(".notification"):
            return

        self._edges[event.event_id] = _WaitEdge(
            request_id=event.event_id,
            waiter=waiter,
            target=target,
            expires_at=time.time() + self._edge_ttl,
        )

        cycle = self._find_cycle(waiter)
        if cycle:
            await self._notify_cycle(cycle)

    def waiting_targets(self, waiter: str) -> List[str]:
        """Agents the given agent currently waits on (for introspection)."""
        return [e.target for e in self._edges.values() if e.waiter == waiter]

    def _is_agent_to_agent(self, waiter: Optional[str], target: Optional[str]) -> bool:
        if not waiter or not target or waiter == target:
            return False
        for endpoint in (waiter, target):
            if endpoint.startswith(("channel:", "group:", "network:", "mod:")):
                return False
            if "broadcast" in endpoint:
                return False
        return True

    def _purge_expired(self) -> None:
        now = time.time()
        expired = [rid for rid, e in self._edges.items() if e.expires_at <= now]
        for rid in expired:
            del self._edges[rid]

    def _find_cycle(self, start: str) -> Optional[List[str]]:
        """DFS from `start` over wait edges; return the cycle path if one
        leads back to `start`."""
        adjacency: Dict[str, List[str]] = {}
        for edge in self._edges.values():
            adjacency.setdefault(edge.waiter, []).append(edge.target)

        path: List[str] = [start]
        visited = set()

        def dfs(node: str) -> Optional[List[str]]:
            for neighbor in adjacency.get(node, []):
                if neighbor == start:
                    return path + [start]
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                path.append(neighbor)
                found = dfs(neighbor)
                if found:
                    return found
                path.pop()
            return None

        return dfs(start)

    async def _notify_cycle(self, cycle: List[str]) -> None:
        """Deliver a deadlock notification to every agent on the cycle."""
        agents = list(dict.fromkeys(cycle))  # de-duplicate, keep order
        request_ids = [
            e.request_id
            for e in self._edges.values()
            if e.waiter in agents and e.target in agents
        ]
        logger.warning(
            f"Wait-for cycle detected between agents: {' -> '.join(cycle)}"
        )
        for agent_id in agents:
            notification = Event(
                event_name=DEADLOCK_EVENT_NAME,
                source_id=self._network_id,
                destination_id=agent_id,
                payload={
                    "cycle": cycle,
                    "request_ids": request_ids,
                    "message": (
                        "Deadlock detected. These agents are all blocked "
                        "waiting for a response from the next agent in the "
                        "cycle, so no response can ever be produced. Stop "
                        "waiting and handle the peer's request first."
                    ),
                },
            )
            try:
                await self._deliver(notification)
            except Exception as e:
                logger.error(
                    f"Failed to deliver deadlock notification to {agent_id}: {e}"
                )
