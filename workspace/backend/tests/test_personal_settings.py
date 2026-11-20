# -*- coding: utf-8 -*-
"""Personal settings: a person's own settings, the same on all their devices."""

from tests.test_visibility import _bearer, _tok, no_push, people  # noqa: F401

PROJECTS = {"projects": [{"id": "p1", "name": "FD", "color": 0}], "assignments": {"thread-a": "p1"}}


def _get(client, ws, headers, key="thread_projects"):
    return client.get(f"/v1/personal-settings/{key}?network={ws['id']}", headers=headers)


def _put(client, ws, headers, value, key="thread_projects"):
    return client.put(f"/v1/personal-settings/{key}", json={"network": ws["id"], "value": value}, headers=headers)


def test_a_person_sees_their_settings_on_every_device(client, workspace, people):
    mia = _bearer("mia", workspace)
    assert _get(client, workspace, mia).json()["data"]["value"] is None
    saved = _put(client, workspace, mia, PROJECTS)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["value"] == PROJECTS
    # Another device: the same person, a new request.
    assert _get(client, workspace, _bearer("mia", workspace)).json()["data"]["value"] == PROJECTS
    changed = {**PROJECTS, "assignments": {}}
    assert _put(client, workspace, mia, changed).status_code == 200
    assert _get(client, workspace, mia).json()["data"]["value"] == changed


def test_settings_are_personal(client, workspace, people):
    assert _put(client, workspace, _bearer("mia", workspace), PROJECTS).status_code == 200
    assert _get(client, workspace, _bearer("adam", workspace)).json()["data"]["value"] is None


def test_tokens_and_agents_keep_nothing(client, workspace, people):
    for headers in (_tok(workspace), {**_tok(workspace), "X-Agent-Name": "agent-alpha"}):
        assert _put(client, workspace, headers, PROJECTS).status_code == 403
        data = _get(client, workspace, headers).json()["data"]
        assert data["value"] is None and data["persisted"] is False


def test_only_known_keys_and_valid_values(client, workspace, people):
    mia = _bearer("mia", workspace)
    assert _put(client, workspace, mia, {"a": 1}, key="anything").status_code == 404
    assert _get(client, workspace, mia, key="anything").status_code == 404
    for bad in ({"projects": "x"}, {"projects": [{"id": 1, "name": "x", "color": 0}]},
                {"projects": [], "assignments": {"t": 5}}, ["not", "an", "object"]):
        assert _put(client, workspace, mia, bad).status_code == 400, bad
    huge = {"projects": [{"id": f"p{i}", "name": "x" * 200, "color": 0} for i in range(2000)], "assignments": {}}
    assert _put(client, workspace, mia, huge).status_code == 400
