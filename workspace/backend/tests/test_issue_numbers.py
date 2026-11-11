"""Issues get a per-workspace number used in short links (/issues/42)."""

from tests.test_issues import create, headers, path


def second_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "Other", "agent_name": "agent-beta", "creator_email": "other@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "token": data["token"]}


def test_numbers_count_up_per_workspace(client, workspace):
    first, second = create(client, workspace), create(client, workspace, title="Second")
    other = create(client, second_workspace(client))
    assert (first["number"], second["number"], other["number"]) == (1, 2, 1)


def test_issue_resolves_by_number_or_id(client, workspace):
    create(client, workspace)
    issue = create(client, workspace, title="Find me")
    for ref in (str(issue["number"]), issue["id"]):
        response = client.get(path(workspace, f"/{ref}"), headers=headers(workspace))
        assert response.status_code == 200, response.text
        assert response.json()["data"]["id"] == issue["id"]
    # Writes accept the number too.
    response = client.patch(path(workspace, f"/{issue['number']}"), headers=headers(workspace),
                            json={"status": "closed", "source": "human:alice"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "closed"


def test_number_is_scoped_to_the_workspace(client, workspace):
    create(client, workspace)
    other = second_workspace(client)
    assert client.get(path(other, "/1"), headers=headers(other)).status_code == 404
    assert client.get(path(workspace, "/2"), headers=headers(workspace)).status_code == 404


def test_list_includes_numbers(client, workspace):
    create(client, workspace)
    response = client.get(path(workspace), headers=headers(workspace))
    assert response.status_code == 200, response.text
    assert [i["number"] for i in response.json()["data"]["issues"]] == [1]
