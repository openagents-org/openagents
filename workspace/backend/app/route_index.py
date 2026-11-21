"""Exact-path shortcut for Starlette's route matching.

Starlette tries every route in registration order until one matches. With
~330 routes, ``GET /v1/events`` (most of all traffic) is around route 139, so
each poll runs ~139 regex matches before reaching its handler. Profiling put
this at ~6% of API CPU.

For each parameter-free path (e.g. ``/v1/events``) we precompute the ordered
list of every route whose pattern can match that exact string, and try only
those. Routes whose pattern does not match the path return ``Match.NONE`` in
the normal loop as well, so first-match order, 405 handling and shadowing by an
earlier parameterised route stay exactly as before. Paths not in the index,
websockets, lifespan, and requests that match nothing (404s, slash redirects)
go through Starlette's normal router unchanged.
"""

from __future__ import annotations

import logging

from starlette.routing import BaseRoute, Match, Route, Router, get_route_path
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)


class StaticRouteIndex:
    """Maps a parameter-free path to the routes that can match it, in order."""

    def __init__(self, router: Router) -> None:
        self.router = router
        self._key: tuple[int, int] | None = None
        self._index: dict[str, tuple[BaseRoute, ...]] | None = None

    def candidates(self, path: str) -> tuple[BaseRoute, ...] | None:
        routes = self.router.routes
        key = (id(routes), len(routes))
        if key != self._key:
            # Rebuild if routes were added after startup (rare).
            self._index = build_index(routes)
            self._key = key
        if self._index is None:
            return None
        return self._index.get(path)


def build_index(routes: list[BaseRoute]) -> dict[str, tuple[BaseRoute, ...]] | None:
    # Only routes matched purely by a regex on the path can be indexed. Anything
    # else (Host routing, custom route classes) disables the shortcut entirely.
    if any(getattr(route, "path_regex", None) is None for route in routes):
        logger.warning("route index disabled: a route is not matched by path alone")
        return None
    static_paths = {
        route.path
        for route in routes
        if isinstance(route, Route) and not route.param_convertors
    }
    return {
        path: tuple(route for route in routes if route.path_regex.match(path))
        for path in static_paths
    }


def install_static_route_index(app) -> bool:
    """Put the shortcut in front of ``app.router``'s normal matching."""
    router: Router = app.router
    original: ASGIApp = router.app
    if router.middleware_stack != original:
        # Router-level middleware would be bypassed; leave routing untouched.
        logger.warning("route index not installed: router has its own middleware")
        return False
    index = StaticRouteIndex(router)

    async def indexed_app(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            candidates = index.candidates(get_route_path(scope))
            if candidates:
                partial = None
                partial_scope: Scope = {}
                for route in candidates:
                    match, child_scope = route.matches(scope)
                    if match == Match.FULL:
                        scope.setdefault("router", router)
                        scope.update(child_scope)
                        await route.handle(scope, receive, send)
                        return
                    if match == Match.PARTIAL and partial is None:
                        partial, partial_scope = route, child_scope
                if partial is not None:
                    # Same route the full loop would pick: 405 Method Not Allowed.
                    scope.setdefault("router", router)
                    scope.update(partial_scope)
                    await partial.handle(scope, receive, send)
                    return
        await original(scope, receive, send)

    router.middleware_stack = indexed_app
    return True
