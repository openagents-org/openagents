from app.models import EventRecord
from app.services.access_model import Principal
from app.services.personal_files import default_file_folder, personal_folder
from app.routers.files import _organize_filename


def test_personal_paths_are_stable_and_escape_separators():
    assert personal_folder(' Maya@Example.com ') == 'people/maya@example.com'
    assert personal_folder('a/b@example.com') == 'people/a%2Fb@example.com'


def test_human_default_and_explicit_destination(db, workspace):
    viewer = Principal('human', email='maya@example.com', workspace_id=workspace['id'])
    folder = default_file_folder(db, workspace['id'], viewer, 'general')
    assert _organize_filename('photo.png', 'image/png', folder).startswith('people/maya@example.com/')
    assert _organize_filename('Reports/photo.png', 'image/png', folder) == 'Reports/photo.png'


def test_agent_output_uses_requester_not_agent_owner(db, workspace):
    db.add(EventRecord(id='request-file', network_id=workspace['id'], type='workspace.message.posted',
        source='human:sifan@example.com', target='channel/general', timestamp=100,
        payload={'content':'Make a report'}, metadata_={'target_agents':['writer']}))
    db.flush()
    viewer = Principal('agent', agent_name='writer', owner_email='maya@example.com', workspace_id=workspace['id'])
    assert default_file_folder(db, workspace['id'], viewer, 'general') == 'people/sifan@example.com'
    assert default_file_folder(db, workspace['id'], viewer) == 'people/maya@example.com'
    db.add(EventRecord(id='other-request', network_id=workspace['id'], type='workspace.message.posted',
        source='human:other@example.com', target='channel/general', timestamp=200,
        payload={'content':'Another report'}, metadata_={'target_agents':['writer']}))
    db.flush()
    assert default_file_folder(db, workspace['id'], viewer, 'general') == 'people/maya@example.com'


def test_multipart_upload_uses_authenticated_person_and_preserves_access(client, db, workspace, monkeypatch, tmp_path):
    from app.storage import LocalFileStore
    monkeypatch.setattr('app.routers.files.get_file_store', lambda: LocalFileStore(str(tmp_path)))
    monkeypatch.setattr('app.routers.files._viewer_for', lambda *args: Principal('human', email='maya@example.com', workspace_id=workspace['id']))
    response = client.post('/v1/files', headers={'X-Workspace-Token': workspace['token']},
        data={'network':workspace['id'], 'source':'human:someone-else@example.com'}, files={'file':('photo.png',b'photo','image/png')})
    assert response.status_code == 200
    result = response.json()['data']
    assert result['filename'].startswith('people/maya@example.com/')
    from app.models import FileRecord
    record = db.get(FileRecord, result['id'])
    assert record.owner == 'human:maya@example.com'
    assert record.visibility == 'private'


def test_generated_cloud_image_uses_requester_folder(db, workspace, monkeypatch, tmp_path):
    import asyncio
    from app.storage import LocalFileStore
    from app.services.cloud_agent import _upload_image
    from app.models import FileRecord
    monkeypatch.setattr('app.storage.get_file_store', lambda: LocalFileStore(str(tmp_path)))
    db.add(EventRecord(id='image-request', network_id=workspace['id'], type='workspace.message.posted',
        source='human:sifan@example.com', target='channel/general', timestamp=100,
        payload={'content':'Draw a picture'}, metadata_={'target_agents':['artist']}))
    db.flush()
    file_id = asyncio.run(_upload_image(db, workspace['id'], 'channel/general', 'artist', b'png', 'png', 'Draw a picture'))
    record = db.get(FileRecord, file_id)
    assert record.filename.startswith('people/sifan@example.com/')
    assert record.visibility is None
    assert record.channel_name == 'general'
