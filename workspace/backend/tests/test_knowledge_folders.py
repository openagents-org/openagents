"""Shared folders do not disclose or grant access to private knowledge."""
from app.models import Workspace
from tests.test_visibility import _bearer, people, no_push  # noqa: F401


def test_folders_visible_but_private_entries_stay_private(client, workspace, people, db):
    network = workspace['id']
    def folder(path, user='mia'):
        return client.post('/v1/knowledge-folders', headers=_bearer(user, workspace), json={'network':network, 'path':path})
    assert folder('Engineering').status_code == 200
    assert folder('Engineering/Plans').status_code == 200
    assert folder('Engineering/Plans').status_code == 200
    for invalid in ['../secret', 'Engineering//Plans', 'Missing/Child', 'Engineering/../secret']:
        assert folder(invalid).status_code in (400,404)
    folders = client.get(f'/v1/knowledge-folders?network={network}', headers=_bearer('vic',workspace)).json()['data']['folders']
    assert folders == ['Engineering', 'Engineering/Plans']
    response = client.post('/v1/knowledge', headers=_bearer('mia',workspace), json={
        'network':network, 'title':'Launch notes', 'content':'Private plans', 'folder_path':'Engineering/Plans'})
    assert response.status_code == 200, response.text
    entry = response.json()['data']
    assert entry['path'] == '/Engineering/Plans/launch-notes'
    assert entry['visibility'] == 'private'
    rows = client.get(f'/v1/knowledge?network={network}', headers=_bearer('vic',workspace)).json()['data']['entries']
    assert entry['id'] not in [row['id'] for row in rows]
    assert client.get(f"/v1/knowledge/{entry['id']}", headers=_bearer('vic',workspace)).status_code == 403
    update = {'network':network, 'folder_path':'Engineering'}
    assert client.put(f"/v1/knowledge/{entry['id']}", headers=_bearer('vic',workspace), json=update).status_code == 403
    moved = client.put(f"/v1/knowledge/{entry['id']}", headers=_bearer('mia',workspace), json=update)
    assert moved.status_code == 200, moved.text
    assert moved.json()['data']['id'] == entry['id']
    assert moved.json()['data']['path'] == '/Engineering/launch-notes'
    assert moved.json()['data']['visibility'] == 'private'
    client.delete(f"/v1/knowledge/{entry['id']}?network={network}",headers=_bearer('mia',workspace))
    assert client.get(f"/v1/knowledge/{entry['id']}", headers=_bearer('mia',workspace)).status_code == 404


def test_wrong_workspace_cannot_move_or_delete_entry(client, workspace, people, db):
    other = Workspace(name='Other', slug='other-folder-test', password_hash='other-secret')
    db.add(other); db.commit()
    response = client.post('/v1/knowledge', headers=_bearer('mia',workspace), json={
        'network':workspace['id'], 'title':'Personal', 'content':'Secret'})
    entry = response.json()['data']['id']
    headers = {'X-Workspace-Token':'other-secret'}
    response = client.put(f'/v1/knowledge/{entry}', headers=headers, json={'network':str(other.id),'folder_path':''})
    assert response.status_code == 404, response.text
    assert client.delete(f'/v1/knowledge/{entry}?network={other.id}',headers=headers).status_code == 404
