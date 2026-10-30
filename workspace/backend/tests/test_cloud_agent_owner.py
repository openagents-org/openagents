# -*- coding: utf-8 -*-
"""Only a cloud agent's owner may reconfigure or remove it.

Being able to use an agent someone added to the workspace does not make its
model, key or prompt yours to change — the rule the member routes already
apply to every other agent.
"""

from tests.test_visibility import _bearer, no_push, people  # noqa: F401


def _add(client, workspace, by):
    body = {
        "network": workspace["id"],
        "agent_name": "relay-bot",
        "provider": "custom",
        "model": "some-model",
        "api_key": "sk-relay-secret-1",
        "base_url": "https://relay.example.com/v1",
    }
    r = client.post("/v1/cloud-agents", json=body, headers=_bearer(by, workspace))
    assert r.status_code == 200, r.text


def _patch(client, workspace, by, **body):
    return client.patch(
        "/v1/cloud-agents/relay-bot",
        json={"network": workspace["id"], **body},
        headers=_bearer(by, workspace),
    )


def _delete(client, workspace, by):
    return client.delete(
        f"/v1/cloud-agents/relay-bot?network={workspace['id']}",
        headers=_bearer(by, workspace),
    )


def test_another_member_cannot_reconfigure_it(client, workspace, people):
    _add(client, workspace, by="adam")
    r = _patch(client, workspace, by="mia", api_key="sk-mia", system_prompt="mine now")
    assert r.status_code == 403
    assert _patch(client, workspace, by="adam", system_prompt="still mine").status_code == 200


def test_another_member_cannot_remove_it(client, workspace, people):
    _add(client, workspace, by="adam")
    assert _delete(client, workspace, by="mia").status_code == 403
    assert _delete(client, workspace, by="adam").status_code == 200
