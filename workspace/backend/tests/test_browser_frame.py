from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
import pytest
from PIL import Image
from app.services.browser_frame import standard_browser_frame
from app.models import BrowserTab
from app.routers import browser


def png(size):
    output = BytesIO()
    Image.new('RGB', size, '#f4f6fa').save(output, format='PNG')
    return output.getvalue()


@pytest.mark.parametrize('size,expected', [((1920,1080),(853,480)), ((1280,720),(853,480)), ((600,1200),(240,480)), ((320,180),(320,180))])
def test_sd_preserves_aspect_ratio_without_upscaling(size, expected):
    with Image.open(BytesIO(standard_browser_frame(png(size)))) as frame:
        assert frame.format == 'JPEG'
        assert frame.size == expected


def test_sd_is_opt_in_for_api_and_does_not_change_browser_viewport(client, db, workspace, monkeypatch):
    tab = BrowserTab(workspace_id=workspace['id'], created_by='openagents:agent-alpha', url='https://example.com', status='active')
    db.add(tab); db.commit()
    original = png((1280,720))
    manager = MagicMock()
    manager.screenshot = AsyncMock(return_value=original)
    manager.get_current_url = AsyncMock(return_value=None)
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    monkeypatch.setattr(browser, '_ensure_connected', AsyncMock())
    url = f'/v1/browser/tabs/{tab.id}/screenshot'
    headers = {'X-Workspace-Token':workspace['token']}
    response = client.get(url,headers=headers)
    assert response.content == original
    assert response.headers['content-type'] == 'image/png'
    response = client.get(url+'?quality=sd',headers=headers)
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/jpeg'
    with Image.open(BytesIO(response.content)) as frame:
        assert frame.size == (853,480)
    manager.set_viewport_size.assert_not_called()
    assert client.get(url+'?quality=sd').status_code == 401
    assert client.get(url+'?quality=invalid',headers=headers).status_code == 422
