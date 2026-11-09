"""Issue boards: a fixed Team issues board plus boards people add."""
from tests.test_visibility import _bearer, people, no_push  # noqa: F401


def url(ws, suffix=""):
    return f"/v1/issues{suffix}?network={ws['id']}"


def boards(client, ws, user="mia"):
    response = client.get(url(ws, "/boards"), headers=_bearer(user, ws))
    assert response.status_code == 200, response.text
    return response.json()["data"]["boards"]


def make_board(client, ws, name, user="mia"):
    return client.post(url(ws, "/boards"), headers=_bearer(user, ws), json={"name": name})


def make_issue(client, ws, title, user="mia", **extra):
    response = client.post(url(ws), headers=_bearer(user, ws), json={"title": title, **extra})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def titles(client, ws, board=None, user="mia"):
    suffix = f"&board={board}" if board else ""
    response = client.get(url(ws) + suffix, headers=_bearer(user, ws))
    assert response.status_code == 200, response.text
    return sorted(i["title"] for i in response.json()["data"]["issues"])


def test_team_board_is_always_there_and_first(client, workspace, people):
    listed = boards(client, workspace)
    assert listed == [{"id": "team", "name": "Team issues", "default": True, "active_count": 0, "can_manage": False}]


def test_create_board_and_file_issues_on_it(client, workspace, people):
    dev = make_board(client, workspace, "  Development   issues ").json()["data"]
    assert dev["name"] == "Development issues" and dev["can_manage"] is True
    make_issue(client, workspace, "Crash on login", board_id=dev["id"])
    make_issue(client, workspace, "Plan the offsite")
    assert titles(client, workspace, dev["id"]) == ["Crash on login"]
    assert titles(client, workspace, "team") == ["Plan the offsite"]
    assert titles(client, workspace) == ["Crash on login", "Plan the offsite"]  # no board filter: everything
    listed = {b["name"]: b for b in boards(client, workspace)}
    assert listed["Development issues"]["active_count"] == 1 and listed["Team issues"]["active_count"] == 1


def test_move_issue_between_boards(client, workspace, people):
    marketing = make_board(client, workspace, "Marketing").json()["data"]
    issue = make_issue(client, workspace, "Launch video")
    assert issue["board_id"] == "team"
    moved = client.patch(url(workspace, f"/{issue['id']}"), headers=_bearer("mia", workspace), json={"board_id": marketing["id"]})
    assert moved.status_code == 200 and moved.json()["data"]["board_id"] == marketing["id"]
    assert titles(client, workspace, "team") == []
    back = client.patch(url(workspace, f"/{issue['id']}"), headers=_bearer("mia", workspace), json={"board_id": "team"})
    assert back.json()["data"]["board_id"] == "team"
    detail = client.get(url(workspace, f"/{issue['id']}"), headers=_bearer("mia", workspace)).json()["data"]
    assert any("moved this issue to Marketing" in (c.get("content") or "") for c in detail.get("comments", []))


def test_board_names_are_unique_and_team_issues_is_reserved(client, workspace, people):
    assert make_board(client, workspace, "Customers").status_code == 200
    assert make_board(client, workspace, "customers").status_code == 409
    assert make_board(client, workspace, "Team Issues").status_code == 409
    assert make_board(client, workspace, "   ").status_code == 422


def test_only_creator_or_admin_can_rename_or_delete(client, workspace, people):
    board = make_board(client, workspace, "Customers", user="mia").json()["data"]
    assert {b["name"]: b["can_manage"] for b in boards(client, workspace, user="adam")}["Customers"] is True
    assert client.patch(url(workspace, f"/boards/{board['id']}"), headers=_bearer("vic", workspace), json={"name": "X"}).status_code == 403
    renamed = client.patch(url(workspace, f"/boards/{board['id']}"), headers=_bearer("mia", workspace), json={"name": "Customer reports"})
    assert renamed.status_code == 200 and renamed.json()["data"]["name"] == "Customer reports"
    assert client.delete(url(workspace, "/boards/team"), headers=_bearer("adam", workspace)).status_code == 404


def test_deleting_a_board_keeps_its_issues_on_team_issues(client, workspace, people):
    board = make_board(client, workspace, "Customers").json()["data"]
    make_issue(client, workspace, "Refund request", board_id=board["id"])
    deleted = client.delete(url(workspace, f"/boards/{board['id']}"), headers=_bearer("adam", workspace))
    assert deleted.status_code == 200 and deleted.json()["data"]["moved_issues"] == 1
    assert titles(client, workspace, "team") == ["Refund request"]
    assert [b["name"] for b in boards(client, workspace)] == ["Team issues"]


def test_unknown_board_is_rejected(client, workspace, people):
    response = client.post(url(workspace), headers=_bearer("mia", workspace), json={"title": "x", "board_id": "nope"})
    assert response.status_code == 404
    assert client.get(url(workspace) + "&board=nope", headers=_bearer("mia", workspace)).status_code == 404


def test_viewer_cannot_create_boards(client, workspace, people):
    assert make_board(client, workspace, "Mine", user="vic").status_code == 403
