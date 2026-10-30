# Two backend nodes in SFO3

Both HTTP nodes run the same release image and share PostgreSQL, S3 file storage,
Valkey (TLS with the provider CA), and signing/authentication configuration.
Each node runs 8 workers with THREADPOOL_TOKENS=6, DB_POOL_SIZE=6, and
DB_MAX_OVERFLOW=2. The two web containers can use at most 128 PostgreSQL
connections together; account separately for deployment overlap and other clients
against the current 200-connection database ceiling.

Set BACKGROUND_JOBS_ENABLED=true on the first node and false on the second.
The flag defaults to true for existing installations. Disabling it suppresses the
timer/maintenance loop and startup browser sweep while retaining request thread
limits, readiness, and browser shutdown. This keeps the additional HTTP node
from starting duplicate scheduled jobs. It does not fix existing per-worker
scheduler duplication on the first node. Scheduled jobs do not automatically
fail over if the first node goes down; moving to a dedicated, coordinated
scheduler is a separate change. Never disable jobs everywhere.

Use a public Regional HTTP load balancer in the same VPC: port 80 to port 80,
HTTP /ready health checks every 10 seconds with a 5-second timeout and 3 healthy
or unhealthy observations, backend keepalive enabled, idle timeout 300 seconds,
sticky sessions and PROXY protocol disabled. Retain existing Cloudflare TLS
behavior when changing the backend DNS record. Validate streaming through the
full path; avoid abruptly stopping a backend with established streams.

Before enrolling a second backend: verify TLS to Valkey, shared keys and pub/sub
between nodes, database readiness, authenticated polling and file reads. Keep
only one active Redis namespace during cutover; old and new Redis services do not
share cache invalidations or event notifications. Drain/remove old services before
splitting new requests across both nodes. Store credentials in root-readable env
files outside Git and mount the Valkey CA read-only. Configure the same Valkey URL
on every serving node. A single-node managed Valkey cluster is not highly available.

After rollout: verify both load-balancer targets, public health/readiness,
authenticated requests, live traffic latency, CPU, database connections, and errors
on each node. Keep the former image/configuration and DNS record for rollback.
Rollback nodes together to the same cache endpoint; do not silently split pub/sub.
