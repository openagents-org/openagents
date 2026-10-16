"""Thread settings are isolated, authorized and server-controlled."""
import pytest
from app.config import config
from app.services.thread_collaboration import save, settings, instruction_blocks
from tests.test_visibility import people, no_push, _bearer
from tests.test_agent_request_sharing import private_agent

@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setattr(config, 'THREAD_COLLABORATION_ENABLED', True)


def update(client, ws, user='mia', **values):
    return client.put('/v1/channels/settings-test/agents/agent-alpha/collaboration',
        headers=_bearer(user, ws), json={'network': ws['id'], 'instructions': 'Review and cite evidence', **values})


def test_owner_can_save_but_other_participant_cannot(client, workspace, private_agent, db):
    assert update(client, workspace, user='vic').status_code == 403
    response = update(client, workspace)
    assert response.status_code == 200, response.text
    assert settings(db, workspace['id'], 'settings-test')['agent-alpha']['instructions'] == 'Review and cite evidence'
    assert settings(db, workspace['id'], 'another-thread') == {}
    assert settings(db, 'another-workspace', 'settings-test') == {}
    assert private_agent.description != 'Review and cite evidence'
    assert update(client, workspace, review_after='agent-alpha').status_code == 400
    assert update(client, workspace, review_after='missing').status_code == 400


def test_last_update_wins_even_in_same_millisecond(db, workspace, monkeypatch):
    monkeypatch.setattr('app.services.thread_collaboration.time.time_ns', lambda: 123000000)
    save(db, workspace['id'], 'one', 'scout', 'First', None, 'me@example.com'); db.flush()
    save(db, workspace['id'], 'one', 'scout', 'Second', 'executor', 'me@example.com'); db.flush()
    assert instruction_blocks(db, workspace['id'], 'one', ['scout'])['scout'].startswith('Second')
    assert instruction_blocks(db, workspace['id'], 'two', ['scout']) == {}


def test_flag_and_raw_event_cannot_bypass_settings_permissions(client, workspace, private_agent, monkeypatch):
    response = client.post('/v1/events', headers=_bearer('vic', workspace), json={
        'network': workspace['id'], 'type': 'workspace.thread.collaboration.updated',
        'source': 'human:vic@acme.test', 'target': 'channel/settings-test', 'payload': {'agents': {'agent-alpha': {'instructions': 'Injected'}}}})
    assert response.status_code == 403
    monkeypatch.setattr(config, 'THREAD_COLLABORATION_ENABLED', False)
    assert update(client, workspace).status_code == 403
