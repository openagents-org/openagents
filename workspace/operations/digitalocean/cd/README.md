# DigitalOcean automatic backend deployments

A push to `release` builds that exact commit and rolls it out to the secondary,
then the primary backend. Use the existing **Promote develop to release** workflow
to ship a merged develop commit. The frontend continues using its existing deployment.
The deployment workflow can also be run manually against `release` to retry it.

The build job receives no deployment secrets. Its explicit Docker context allowlist
excludes environment files, operations files and credentials. The deployment job uses
the `digitalocean-production` GitHub environment, restricted to `release`, with:

- Secrets `DO_DEPLOY_SSH_KEY`, `DO_DEPLOY_KNOWN_HOSTS`.
- Variables `DO_PRIMARY_HOST`, `DO_SECONDARY_HOST`.

The dedicated SSH key is restricted by root-owned forced commands on both servers.
It can stage an image, start a rollout, and inspect deployment status, but cannot
open an interactive shell or change routing directly. A separate restricted key
allows the coordinator to update the secondary. Host keys are pinned. Anyone able
to publish release code can execute application code in production; branch protections
remain essential. Do not copy developer SSH keys into GitHub.

## Server installation

Install `deploy.py`, `rollout.py`, `migration_plan.py`, and `backup.py` under the
root-owned `/opt/openagents/cd` directory (mode 0700). Python dependencies are PyYAML,
boto3 and botocore; PostgreSQL client tools must support the server version.
Root-owned `config.json` supplies coordinator flag, node IDs, peer host, local/peer
Nginx upstream addresses, upstream file, public URL, load balancer ID, DO token file
and migration Docker network. Node configuration and credentials are not tracked.

Keep all credentials in `cd/secrets` (0700 directory, 0600 files): `migration.env`
(admin DATABASE_URL), `smoke.json` (workspace and token), `backup.json` (libpq env and
Spaces settings), and the coordinator's `peer-key`. The application's existing
`/opt/openagents/secrets/production.env` stays on each server. Pin peer SSH host keys
in `cd/peer-known-hosts`. Configure authorized_keys with `restrict` and a forced
`python3 /opt/openagents/cd/deploy.py ci` or `peer` command; restrict the peer key's
source address to the coordinator's private IP.

## Rollout and migrations

Both nodes must be ready, contain the candidate image, and be the exact members of
the load balancer. The coordinator compares database revision to the candidate's
Alembic head. Every pending migration must explicitly declare
`deployment_backward_compatible = True`; review this declaration carefully. Use
expand/contract changes compatible with the currently running image. Unmarked
migrations stop deployment before any traffic changes. The declaration is a review
contract, not a proof of compatibility.

Pending migrations trigger a consistent PostgreSQL custom-format backup in the
private Spaces bucket. The archive is checked with pg_restore, downloaded and
SHA-256 verified, and anonymous access must be denied. Migration runs once, before
replacing either node. Database schema/data are never automatically downgraded.

For each node, remove it from the load balancer and temporarily forward new requests
to its peer, update its image, check readiness/cache/authenticated reads, restore local
routing and re-add it. Long-lived connections on the replaced process may reconnect.
The primary retains background jobs; the secondary has them disabled. This does not
provide automatic scheduler failover. Public verification follows the rollout.
Failures restore previous images; failed rollback nodes remain out of rotation.

The coordinator runs as `openagents-auto-deploy.service`, independently of Actions
connectivity. `cd/result-<sha>.json` and `cd/last-result.json` record status. Detailed
logs stay in root-only `cd/operations.log`; they may contain sensitive application
errors and must not be pasted into GitHub. If status is `interrupted` or
`rollback_failed`, inspect node readiness, routing and load balancer membership
before retrying. Do not automatically restart a partially completed rollout.

The forced-command scripts are host administration code, not automatically replaced
by application releases. Changes to them require testing and explicit installation.
Run tests with `python3 -m unittest discover -s workspace/operations/digitalocean/cd/tests -v`.
