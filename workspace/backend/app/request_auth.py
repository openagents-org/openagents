"""Reuse authentication work only during one HTTP request, never across callers."""
from contextvars import ContextVar
from functools import wraps
from threading import RLock

from sqlalchemy import event
from sqlalchemy.orm import Session


class _RequestAuth:
    def __init__(self):
        self.identity = {}
        self.roles = {}
        self.lock = RLock()
        self.active = True

    def close(self):
        with self.lock:
            self.active = False
            self.identity.clear()
            self.roles.clear()


_current = ContextVar("request_auth", default=None)


def request_cached(fn=None, *, database=False):
    """Outside HTTP requests behave normally; exceptions are never memoized.

    ContextVars propagate into Starlette's sync worker threads. The shared
    request object also gets disabled at response start, so streaming responses
    and inherited background tasks cannot keep using an old authorization result.
    """
    def decorate(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            state = _current.get()
            if state is None or not state.active:
                return func(*args, **kwargs)
            with state.lock:
                if not state.active:
                    return func(*args, **kwargs)
                values = state.roles if database else state.identity
                if database:
                    db = args[0] if args else kwargs["db"]
                    # Autoflush may be disabled. Pending writes must not be
                    # masked by a cached read, even before a flush event fires.
                    if db.new or db.dirty or db.deleted:
                        values.clear()
                        return func(*args, **kwargs)
                key = (func, args, tuple(sorted(kwargs.items())))
                if key not in values:
                    result = func(*args, **kwargs)
                    if state.active:
                        values[key] = result
                else:
                    result = values[key]
                # Claims are flat dictionaries; don't let a caller modify the
                # verified result seen by later permission checks.
                return dict(result) if isinstance(result, dict) else result
        return wrapped
    return decorate(fn) if fn is not None else decorate


def _invalidate_roles(*_):
    state = _current.get()
    if state is not None:
        with state.lock:
            state.roles.clear()


def _on_execute(execute_state):
    if not execute_state.is_select:
        _invalidate_roles()


# Role reuse must not outlive writes or a transaction boundary. Core/text SQL
# through Session.execute is conservatively treated as a possible write too.
event.listen(Session, "before_flush", _invalidate_roles)
event.listen(Session, "after_transaction_end", _invalidate_roles)
event.listen(Session, "do_orm_execute", _on_execute)


class RequestAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        state = _RequestAuth()
        token = _current.set(state)

        async def send_response(message):
            if message["type"] == "http.response.start":
                state.close()
            await send(message)

        try:
            await self.app(scope, receive, send_response)
        finally:
            state.close()
            _current.reset(token)
