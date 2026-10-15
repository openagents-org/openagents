import base64
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from app.models import FileRecord, ProjectPreviewTicket
from app.storage import LocalFileStore
from app.routers import web_projects
from tests.test_visibility import _bearer, people, no_push  # noqa: F401
from tests.test_thread_agent_settings import setup_thread
import pytest


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(web_projects, 'get_file_store', lambda: LocalFileStore(str(tmp_path)))


def body(workspace, **updates):
    files = {'index.html':'<img src="assets/chart.svg"><link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/app.js"></script>',
             'assets/chart.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>', 'assets/site.css':'body{color:blue}',
             'assets/app.js':'fetch("./data.json").then(r=>r.json())', 'data.json':'{"count":12}'}
    return {'network':workspace['id'], 'title':'Dashboard', 'entrypoint':'index.html',
            'files':[{'path':p,'content_base64':base64.b64encode(c.encode()).decode()} for p,c in files.items()], **updates}


def create(client, workspace, **updates):
    return client.post('/v1/web-projects', headers=_bearer('mia',workspace), json=body(workspace,**updates))


def preview(client,workspace,pid,user='mia'):
    return client.post(f'/v1/web-projects/{pid}/preview?network={workspace["id"]}',headers=_bearer(user,workspace))


def test_bundle_preview_assets_and_stable_pin_update(client,workspace,people,db):
    setup_thread(client,workspace,db)
    result=create(client,workspace,channel_name='settings-test',visibility='inherit')
    assert result.status_code==200, result.text
    project=result.json()['data']; pid=project['id']
    ref={'kind':'file','id':pid}
    assert client.patch('/v1/channels/settings-test/artifact',headers=_bearer('mia',workspace),json={'network':workspace['id'],'artifact':ref}).status_code==200
    data=preview(client,workspace,pid,'vic').json()['data']
    assert data['can_update']  # Thread participants inherit collaboration rights.
    url=data['preview_path']; base=url.rsplit('/',1)[0]
    html=client.get(url)
    assert html.status_code==200
    assert 'src="assets/chart.svg"' in html.text
    assert 'sandbox allow-scripts;' in html.headers['content-security-policy']
    assert 'connect-src testserver/v1/project-preview/' in html.headers['content-security-policy']
    assert 'allow-same-origin' not in html.headers['content-security-policy']
    assert html.headers['cache-control']=='no-store'
    assert html.headers['access-control-allow-origin']=='*'
    for name in ['assets/chart.svg','assets/site.css','assets/app.js','data.json']:
        assert client.get(base+'/'+name).status_code==200
    assert client.get(base+'/__openagents_project__.json').status_code==404
    assert client.get(base+'/%2E%2E/secret').status_code==404
    update=body(workspace,title='Updated dashboard',expected_revision=project['revision'])
    result=client.put(f'/v1/web-projects/{pid}',headers=_bearer('mia',workspace),json=update)
    assert result.status_code==200, result.text
    assert result.json()['data']['id']==pid
    assert client.get(url).status_code==404
    assert client.put(f'/v1/web-projects/{pid}',headers=_bearer('mia',workspace),json=update).status_code==409
    pin=client.get(f'/v1/channels/settings-test/artifact?network={workspace["id"]}',headers=_bearer('mia',workspace)).json()['data']
    assert pin['artifact']==ref
    row=db.get(FileRecord,pid); db.refresh(row)
    assert row.visibility is None and row.channel_name=='settings-test'


def test_private_expiry_and_revocation(client,workspace,people,db):
    pid=create(client,workspace).json()['data']['id']
    assert preview(client,workspace,pid,'vic').status_code==404
    assert client.put(f'/v1/web-projects/{pid}',headers=_bearer('vic',workspace),json=body(workspace)).status_code==404
    url=preview(client,workspace,pid).json()['data']['preview_path']
    ticket=db.execute(select(ProjectPreviewTicket)).scalar_one()
    ticket.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1); db.commit()
    assert client.get(url).status_code==404
    row=db.get(FileRecord,pid); row.visibility='public'; db.commit()
    url=preview(client,workspace,pid,'vic').json()['data']['preview_path']
    assert client.get(url).status_code==200
    row.visibility='private'; db.commit()
    assert client.get(url).status_code==404
    url=preview(client,workspace,pid).json()['data']['preview_path']
    row.status='deleted'; db.commit()
    assert client.get(url).status_code==404


@pytest.mark.parametrize('path',['../secret','/absolute','assets/../../secret','.env','node_modules/pkg.js','assets\\evil.js','a%2fb','index.html'])
def test_unsafe_or_duplicate_paths_rejected(client,workspace,people,path):
    data=body(workspace); data['files'].append({'path':path,'content_base64':'eA=='})
    assert client.post('/v1/web-projects',headers=_bearer('mia',workspace),json=data).status_code==400


def test_entrypoint_and_invalid_encoding(client,workspace,people):
    assert create(client,workspace,entrypoint='missing.html').status_code==400
    data=body(workspace);data['files'][0]['content_base64']='!!invalid'
    assert client.post('/v1/web-projects',headers=_bearer('mia',workspace),json=data).status_code==400


def test_generic_upload_cannot_bypass_bundle_validation(client,workspace,people,db):
    import io, zipfile
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('__openagents_project__.json','{"entrypoint":"index.html"}')
        z.writestr('index.html','x'*(web_projects.MAX_BYTES+1))
    store=web_projects.get_file_store()
    row=FileRecord(workspace_id=workspace['id'],filename='bad.zip',content_type=web_projects.PROJECT_TYPE,
        size=len(out.getvalue()),storage_key=store.save(workspace['id'],'bad','bad.zip',out.getvalue()),
        uploaded_by='human:mia@acme.test',owner='human:mia@acme.test',visibility='private')
    db.add(row);db.commit()
    assert preview(client,workspace,row.id).status_code==404
