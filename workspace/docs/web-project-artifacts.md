# Static web project artifacts

A web project is one workspace file containing an HTML entry page and its relative assets. Its file ID, sharing policy, thread association, and pinned reference survive updates. Existing Markdown documents and live browser tabs remain separate artifact types.

## Publish from the preview panel

Open the thread's artifact panel, choose **Upload web project**, select a folder, and choose the HTML entry page. Projects published in a channel inherit that channel's access. Outside a channel they start private. Select **Update project** to replace the complete bundle while preserving its identity and sharing.

Include images, CSS, JavaScript, fonts, and JSON data under the folder. Reference them using relative URLs such as `assets/chart.svg`. For a frontend framework, build the app first with a relative asset base and upload the static output directory. Root-relative URLs, external resources, nested frames, server code, service workers, and backend processes are not supported by this preview. Hidden files and dependency folders are excluded from folder selection. Limits: 500 files, 25 MB total.

Open previews check for a new version every 15 seconds while visible. Owners can pin the project through the existing artifact pin control. Pinning does not grant access to the project.

## Publish from an agent

The connector adds `workspace_publish_project` under the Files module. It accepts a title, entrypoint, and explicit files with either UTF-8 `content` or `content_base64`. A project update also requires `project_id` and `expected_revision`. Connector publication is a separate rollout; the HTTP API works independently.

HTTP endpoints:

- `POST /v1/web-projects`: `{network, title, entrypoint, files: [{path, content_base64}], channel_name, source, visibility}`. Set visibility to `inherit` in a channel or `private` otherwise.
- `PUT /v1/web-projects/{id}`: same complete bundle plus `expected_revision`. Existing sharing and channel association remain unchanged. A stale revision returns 409.
- `GET /v1/web-projects/{id}?network=...`: current revision, checked against file access.
- `POST /v1/web-projects/{id}/preview?network=...`: authenticated preview session and manifest.

Use normal workspace/agent authentication. Link the returned ID in chat as `[Dashboard](/v1/files/ID)` so the right-hand preview opens. The permanent UI route is `/{workspace}/files/{id}`.

## Isolation and storage

The entire project is a ZIP-backed `FileRecord` with MIME `application/vnd.openagents.web-project+zip`. Assets are not separate shared files. Existing download, sharing, trash, and purge behavior applies to the bundle.

Preview URLs use random, one-hour, project-and-version-scoped tickets stored only as hashes. Each asset request rechecks the original viewer's current access; changed permissions, deletion, expired tickets, or a superseded version prevent further asset reads. No workspace credential is placed in the preview URL. Frames and direct navigation are sandboxed without same-origin privileges. CSP restricts assets and data requests to that project's preview path; referrers and response caching are disabled.

Migration 076 creates the preview ticket table. Deploy it before the backend router.
