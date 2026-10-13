# Live browser artifacts

Shared browser work can be opened beside a conversation with a Preview button.
The first agent operation on a tab in a conversation posts one live preview card.
The tab also stays in that conversation’s artifact bar while it is open. Later
navigation updates the same tab; it does not add another card for every action.
A thread owner can pin the tab as the default artifact.

Pass `source: "openagents:<agent-name>"` and `channel: "<channel-name>"` when
opening a tab or performing an action through `/v1/browser/tabs`. Reads
(`/snapshot` and `/screenshot`) accept these as query parameters. The connector
supplies both automatically on its browser tools. Direct HTTP callers and older
connectors should include them explicitly. The server remembers the last thread
for later operations, including after a restart, but never guesses a thread from
agent membership. When reusing a tab in another thread, pass that thread explicitly.

A stable Markdown link of the form `/v1/browser/tabs/<tab-id>` produces a preview
card and opens the live browser panel; it continues working after navigation.
Browser tabs retain the workspace browser’s existing access rules. Attaching or
pinning one does not grant extra access. The preview is a live session, not a
saved web page: closed tabs become unavailable, and idle tabs follow the normal
browser sleep/cleanup policy. Local/private browser sessions outside the shared
workspace browser cannot be previewed through this mechanism.

Backend migration 077 and the frontend can be deployed independently of the
connector. Automatic thread context on existing device connectors requires the
updated connector; explicit HTTP requests work without a connector rollout.
