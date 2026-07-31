"""Server-side wait-for graph deadlock detection.

Every event in a network flows through the central event gateway, which makes
the server the natural place to watch for agents waiting on each other.
Blocking wait primitives (``send_and_wait``) mark their request event with
``metadata={"blocking_wait": True, "wait_timeout": <seconds>}``; such an event
from agent A to agent B registers a directed wait edge A -> B keyed by the
request's event id. An event whose ``response_to`` references that request
clears the edge, and an edge expires at the waiter's own deadline, so an
abandoned wait (client crash, timeout without a response event) cannot poison
the graph.

``requires_response`` alone deliberately does NOT create an edge: it only
means a reply is expected some time, not that the sender is blocked — a
continuation-style request must never be reported as part of a deadlock.

If adding an edge closes a cycle (A waits on B while B — directly or
transitively — waits on A), every agent on the cycle is notified with an
``agent.wait.deadlock_detected`` event naming the cycle and the exact request
ids forming it, so the affected waiters can fail fast instead of blocking
until timeout with no explanation. Other concurrent requests between the same
agents are not named and keep waiting normally.

This catches the wait cycles that delegation-chain validation cannot see:
mutual ``send_and_wait`` calls, independent tasks pointing at each other, and
mixed-mechanism cycles.
"""

import logging
import time
from typing import Awaitable, Callable, Dict, List, Optional

from openagents.models.event import Event

logger = logging.getLogger(__name__)

DEADLOCK_EVENT_NAME = "agent.wait.deadlock_detected"

# Fallback edge lifetime when the request does not carry its own deadline.
# Client-side blocking waits default to 30s; keep edges a bit longer so slow
# responses still clear them.
DEFAULT_EDGE_TTL_SECONDS = 60.0

# Upper bound on any edge lifetime, whatever deadline the client claims.
MAX_EDGE_TTL_SECONDS = 3600.0


def _metadata_flag(value) -> bool:
    """Interpret a metadata value as a boolean.

    Transports may stringify metadata (gRPC uses map<string,string>), so
    "False"/"0" must not count as truthy.
    """
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _metadata_number(value) -> Optional[float]:
    """Interpret a metadata value as a finite positive number, else None."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0 or number != number or number == float("inf"):
        return None
    return number


def canonical_agent_id(agent_id: Optional[str]) -> str:
    """Normalize an agent id for wait-graph identity comparisons.

    Strips whitespace and a leading ``agent:`` prefix so that
    ``alice -> agent:bob`` and ``bob -> agent:alice`` join into one graph.
    """
    if not agent_id:
        return ""
    normalized = str(agent_id).strip()
    if normalized.startswith("agent:"):
        normalized = normalized[len("agent:"):]
    return normalized


class _WaitEdge:
    __slots__ = ("request_id", "waiter", "target", "expires_at")

    def __init__(self, request_id: str, waiter: str, target: str, expires_at: float):
        self.request_id = request_id
        self.waiter = waiter
        self.target = target
        self.expires_at = expires_at


class WaitGraphMonitor:
    """Observes gateway traffic and detects blocking-wait cycles."""

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
            edge_ttl_seconds: Edge lifetime for requests without a deadline
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

        # Only explicitly-marked blocking waits become edges; a plain
        # requires_response request does not prove the sender is blocked.
        metadata = event.metadata or {}
        if not _metadata_flag(metadata.get("blocking_wait")):
            return

        waiter = canonical_agent_id(event.source_id)
        target = canonical_agent_id(event.destination_id)
        if not self._is_agent_to_agent(waiter, target):
            return

        # Mod relays (…​.notification) duplicate the original request with a
        # fresh event id; the reply's response_to references the original, so
        # a relay edge would never be cleared. Track the original only.
        if event.event_name.endswith(".notification"):
            return

        ttl = _metadata_number(metadata.get("wait_timeout"))
        if ttl is None:
            ttl = self._edge_ttl
        ttl = min(ttl, MAX_EDGE_TTL_SECONDS)

        self._edges[event.event_id] = _WaitEdge(
            request_id=event.event_id,
            waiter=waiter,
            target=target,
            expires_at=time.time() + ttl,
        )

        cycle_edges = self._find_cycle(waiter)
        if cycle_edges:
            await self._notify_cycle(cycle_edges)

    def waiting_targets(self, waiter: str) -> List[str]:
        """Agents the given agent currently waits on (for introspection)."""
        waiter = canonical_agent_id(waiter)
        return [e.target for e in self._edges.values() if e.waiter == waiter]

    def _is_agent_to_agent(self, waiter: str, target: str) -> bool:
        # A self-wait (waiter == target) is a valid single-node cycle and is
        # intentionally let through.
        if not waiter or not target:
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

    def _find_cycle(self, start: str) -> Optional[List[_WaitEdge]]:
        """DFS from `start` over wait edges; return the exact edges forming a
        cycle back to `start`, or None."""
        adjacency: Dict[str, List[_WaitEdge]] = {}
        for edge in self._edges.values():
            adjacency.setdefault(edge.waiter, []).append(edge)

        edge_path: List[_WaitEdge] = []
        visited = set()

        def dfs(node: str) -> Optional[List[_WaitEdge]]:
            for edge in adjacency.get(node, []):
                if edge.target == start:
                    return edge_path + [edge]
                if edge.target in visited:
                    continue
                visited.add(edge.target)
                edge_path.append(edge)
                found = dfs(edge.target)
                if found:
                    return found
                edge_path.pop()
            return None

        return dfs(start)

    async def _notify_cycle(self, cycle_edges: List[_WaitEdge]) -> None:
        """Deliver a deadlock notification to every agent on the cycle.

        Only the request ids of the edges actually forming the cycle are
        reported, so unrelated concurrent waits between the same agents are
        not aborted.
        """
        cycle = [cycle_edges[0].waiter] + [e.target for e in cycle_edges]
        agents = list(dict.fromkeys(cycle))  # de-duplicate, keep order
        request_ids = [e.request_id for e in cycle_edges]
        # The notified waiters return immediately, so their waits no longer
        # exist — drop the edges now or they would keep "deadlocking" new
        # requests until their original timeouts.
        for edge in cycle_edges:
            self._edges.pop(edge.request_id, None)
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
