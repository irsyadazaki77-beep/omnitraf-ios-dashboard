# Cluster and PostgreSQL Recovery Runbook

OmniTRAF is a traffic simulation platform. Cluster actions and telemetry remain within `SIMULATION_ONLY`; they do not control physical traffic infrastructure.

## Authority and failure behavior

- PostgreSQL is the durable source for incidents, device/signal configuration, audit history, command receipts, and leadership fencing epochs.
- Redis coordinates leader candidacy, short-lived idempotency acceleration, snapshots, and realtime fanout. Pub/Sub and Redis snapshots are not durable queues or backups.
- A candidate must own the Redis lease and claim the current PostgreSQL epoch before becoming leader. Every authoritative command transaction verifies the same instance/epoch at entry and immediately before commit, and renews/verifies Redis at that commit boundary.
- When Redis or PostgreSQL is unavailable, the node stops authoritative loops and command mutations fail closed. `/readyz` returns 503. Once an established process reconnects, Redis election resumes; a process that failed mandatory hydration during startup remains unavailable and should be restarted after PostgreSQL recovery.
- Followers use full, versioned snapshots. Lower state versions are rejected. Before a promoted leader starts, it reloads durable domains from PostgreSQL to cover a crash after commit but before snapshot/acknowledgement.
- A Redis runtime checkpoint is resumable only while its 30 second key remains available and validates against the supported snapshot schema. After it expires or Redis data is lost, the process starts a new simulation session using durable PostgreSQL state; it must not describe a fresh RNG/clock as an old checkpoint resume.
- PostgreSQL commit does not atomically include Redis, in-memory state, or Socket.io. Durable receipts make supported command effects replayable after ambiguous acknowledgements; realtime delivery remains retry/resync based.

## Start and clean the local cluster test

The root `docker-compose.cluster.yml` topology contains one PostgreSQL service, one Redis service, and three application instances with unique instance IDs. Credentials are for local testing only.

```bash
docker compose -f docker-compose.cluster.yml up -d --build --wait
docker compose -f docker-compose.cluster.yml ps
docker compose -f docker-compose.cluster.yml logs --tail=100 node-a node-b node-c
docker compose -f docker-compose.cluster.yml down -v
```

`down -v` deletes the isolated test database volume. Do not point this Compose file at production data.

## Backup and isolated restore drill

Install PostgreSQL client binaries `pg_dump` and `pg_restore`. Supply `DATABASE_URL` through the operator's secret environment mechanism; scripts do not print the URL/password. `backup:postgres` writes a timestamped custom-format archive and refuses to overwrite an existing name.

```bash
DATABASE_URL="$OMNITRAF_BACKUP_DATABASE_URL" npm run backup:postgres
DATABASE_URL="$OMNITRAF_RESTORE_OPERATOR_URL" npm run verify:postgres-backup -- backups/omnitraf-<timestamp>.dump
```

The verifier requires permission to create/drop a random scratch database on the specified PostgreSQL server. It restores there, checks migration history and counts for audit rows and command receipts, reports those counts, and removes only its own scratch database. It never restores over the configured database. If the restore drill fails, preserve the archive and investigate before changing a live database.

Production restoration requires an operator-approved maintenance window, a separately identified target, verified backups, and an explicit deployment procedure. These scripts do not restore automatically to production. Record measured backup age, restore duration, and outage duration in the deployment's DR records; RPO/RTO are targets to measure and have no numeric guarantee in this repository.

## PostgreSQL or Redis outage

1. Check `/healthz` for process liveness and `/readyz` for availability; `/ready` remains the authenticated detailed diagnostic route.
2. Keep operational commands disabled while readiness is 503. Do not switch a cluster node to SQL.js as an outage workaround.
3. Restore the failed shared service and verify a normal database query/Redis connection.
4. Confirm the leader epoch and role settle to exactly one leader. Followers must synchronize a valid full snapshot before becoming ready.
5. Retry client commands with the original actor and idempotency key. A command may have committed even if its acknowledgement was lost; PostgreSQL receipts determine the replay result.
6. If a process failed startup hydration, restart that instance after PostgreSQL is healthy. Check that the new leader reconciled incidents, signals, devices, audit, and command receipts from PostgreSQL.

Do not delete fence rows, command receipts, audit history, or Redis keys manually to force failover. Use the normal lease expiry and PostgreSQL fencing flow.
