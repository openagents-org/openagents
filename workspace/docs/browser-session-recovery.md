# Browser session recovery

The October 27, 2026 investigation correlated Workspace's stale worker caches
with BrowserFabric close records: a worker probed an old session, classified the
newer database session as dead, and closed that newer session during recovery.
Provider findings attribute 28 of the 29 inspected replacements' closures to
authenticated integration calls. One separate provider reaper race is addressed
in BrowserFabric PR #57; it does not fix Workspace's recovery loop. The original
initiating failure before the inspected history remains unproven.

## Invariants

- Worker shutdown clears cloud caches without closing remote sessions. The
  sessions belong to the shared database, not to an individual API worker.
  Explicit close and orphan maintenance retain responsibility for remote cleanup.
  Local Playwright pages/processes still close during worker shutdown.
- The database's `browser_tabs.session_id` is authoritative. Reconnecting a
  cached tab updates that mapping and invalidates its stale live-link cache.
- Ordinary reads/actions, validation and Retry never close or create a session.
  Unavailable probes return HTTP 503 with `Retry-After: 2`, preserving the mapping.
  HTTP 404 and generic provider text such as `No active session` are inconclusive.
- Retry calls `/tabs/{id}/reactivate`, even when a preview URL is missing. It
  attempts the same session. Local retries only verify the existing local page.
- Reactivation failures return retryable 503 responses with safe codes separating
  inaccessible sessions, failed wake-up, and unavailable live views. Logs include
  the tab/session IDs, stage, code and exception type, never provider payloads.
  Generic provider absence remains inconclusive; it does not authorize replacement.
- The unavailable view offers an explicit replacement for tabs with saved contexts.
  It fetches the current session identity before asking for confirmation and sends
  that identity to the guarded replacement endpoint. Error messages are shown inline
  without exposing the raw API response. Cancelling never replaces the session.
- Saving a persistent context saves cookies/storage without restarting the page.
- Closing an explicitly identified session must not substitute a cached ID.

## Explicit replacement and reopen

`POST /v1/browser/tabs/{id}/reconnect` replaces a browser and loses unsaved DOM,
JavaScript state and editor content. Restoring a saved context restores login
storage; it does not recover that unsaved state. Callers must explain this before
an intentional replacement. Do not automatically escalate a failed Retry into
this endpoint.

For an active tab, pass `confirm_replace=true` and `expected_session_id` from a
fresh authenticated GET of the tab. A stale ID returns 409 before any close or
creation; missing confirmation returns 400. An unavailable browser with no
session ID uses an omitted `expected_session_id` after explicit confirmation.

`reopen=true` remains supported for deliberately reopening a closed tab. If it
is already active, this returns the current tab without replacing it.

Explicit replacement and deletion re-read the row under PostgreSQL
`SELECT ... FOR UPDATE NOWAIT`. A competing lifecycle request returns 409.
The replacement transaction retains this lock across provider I/O, re-reads
before close/create, and conditionally updates the mapping against the original
session ID and status. Credential provisioning occurs before acquiring the lock
because it can commit. No helper may commit during the locked lifecycle phase.
The transaction-specific idle timeout is five minutes to accommodate provider
I/O; ordinary transaction limits are unchanged. SQLite tests do not establish
cross-worker locking guarantees; production uses PostgreSQL.

No database migration is required. All backend replicas must be updated: an old
replica still contains the destructive automatic recovery path. Rollout should
avoid interrupting an active editor operation. This change cannot restore page
state already lost and does not deploy the separate BrowserFabric patch.

## Regression validation

- `tests/test_browser_session_recovery.py`: stale ORM/cache mapping, live-link
  invalidation, explicit close identity, retryable read/action failures,
  overlapping ordinary recovery attempts, replacement confirmation and CAS,
  context saving without replacement, and missing-session default prevention.
- `tests/test_browser_postgres_concurrency.py`: real concurrent connections
  invoking replacement, rejected overlap, stale retry, and conditional writes.
  Run only against a disposable `TEST_DATABASE_URL`; its fixture creates/drops
  the test schema.
- Frontend `browser-recovery.test.ts`: Retry always uses same-session
  reactivation, including when the live URL is missing.
