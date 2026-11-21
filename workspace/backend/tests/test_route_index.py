"""The exact-path routing shortcut must pick the same route Starlette would."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.routing import Match

from app.route_index import StaticRouteIndex, install_static_route_index

METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD")


def _scope(path, method):
    return {"type": "http", "path": path, "root_path": "", "method": method,
            "headers": [], "query_string": b""}


def _linear(routes, scope):
    """Starlette's own algorithm: first FULL wins, else first PARTIAL."""
    partial = None
    for route in routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route, Match.FULL
        if match == Match.PARTIAL and partial is None:
            partial = route
    return (partial, Match.PARTIAL) if partial is not None else (None, Match.NONE)


def test_index_matches_starlette_for_every_static_route_in_the_real_app():
    from app.main import app

    index = StaticRouteIndex(app.router)
    static = [r for r in app.router.routes if getattr(r, "param_convertors", None) == {}]
    assert len(static) > 50
    for route in static:
        candidates = index.candidates(route.path)
        assert candidates, route.path
        for method in METHODS:
            scope = _scope(route.path, method)
            assert _linear(candidates, scope) == _linear(app.router.routes, scope), (method, route.path)


def test_real_app_has_index_installed_and_events_is_a_short_lookup():
    from app.main import app

    assert app.router.middleware_stack.__name__ == "indexed_app"
    candidates = StaticRouteIndex(app.router).candidates("/v1/events")
    assert candidates and len(candidates) < 10


def _toy_app():
    app = FastAPI()

    @app.get("/items/{item_id}")
    def by_id(item_id: str):
        return {"route": "param", "id": item_id}

    @app.get("/items/latest")  # shadowed by the earlier parameterised route
    def latest():
        return {"route": "static"}

    @app.get("/only-get")
    def only_get():
        return {"ok": True}

    @app.post("/same")
    def same_post():
        return {"route": "post"}

    @app.get("/same")
    def same_get():
        return {"route": "get"}

    @app.get("/slash/")
    def slash():
        return {"ok": True}

    assert install_static_route_index(app)
    return app


def test_earlier_parameterised_route_still_wins():
    client = TestClient(_toy_app())
    assert client.get("/items/latest").json() == {"route": "param", "id": "latest"}


def test_method_dispatch_and_405_unchanged():
    client = TestClient(_toy_app())
    assert client.get("/same").json() == {"route": "get"}
    assert client.post("/same").json() == {"route": "post"}
    response = client.post("/only-get")
    assert response.status_code == 405
    assert response.headers["allow"] == "GET"


def test_404_and_slash_redirect_fall_back_to_starlette():
    client = TestClient(_toy_app())
    assert client.get("/missing").status_code == 404
    response = client.get("/slash", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"].endswith("/slash/")


def test_routes_added_after_install_are_picked_up():
    app = _toy_app()
    client = TestClient(app)
    assert client.get("/later").status_code == 404

    @app.get("/later")
    def later():
        return {"ok": True}

    assert client.get("/later").json() == {"ok": True}
