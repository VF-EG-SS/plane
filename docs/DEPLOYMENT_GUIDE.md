# Plane deployment guide

This guide deploys this source checkout with the root `docker-compose.yml`. It is written for a Linux server running Docker Engine and Docker Compose v2.

> Keep configuration and secrets out of Git. The `.env` files below are local deployment inputs and must never be committed.

## What this deployment runs

The Compose stack runs the Plane web, admin, space, API, live, worker, scheduler, migrator, PostgreSQL, Valkey, RabbitMQ, MinIO, and Caddy proxy services. Caddy is the public entry point.

The application changes on `vcs-dev` include stricter attachment validation and a 200 MiB application-level default. The proxy and object storage must be configured to accept the same upload size.

## Prerequisites

- A Linux host with at least 2 vCPU, 4 GiB RAM, free disk space for PostgreSQL and uploaded files, and Docker Engine with Compose v2.
- A DNS A/AAAA record for the intended public name, for example `plane.example.com`.
- Inbound TCP ports 80 and 443 open at the host and network firewall. Port 80 must be reachable for Caddy's HTTP-to-HTTPS redirect and ACME validation.
- A private Git remote or secure transfer mechanism that makes the `vcs-dev` branch available on the server. The branch has not been pushed by this repository workflow.

Check Docker before continuing:

```bash
docker version
docker compose version
```

## 1. Get the application source

Clone the repository or update an existing checkout, then select the deployment revision:

```bash
git fetch origin
git switch vcs-dev
git pull --ff-only origin vcs-dev
git rev-parse --short HEAD
```

The expected application commit is `5a3d69734f` or a later reviewed commit on `vcs-dev`.

## 2. Create local environment files

Only create the files when they do not already exist; do not overwrite an active deployment configuration.

```bash
test -f .env || cp .env.example .env
test -f apps/api/.env || cp apps/api/.env.example apps/api/.env
chmod 600 .env apps/api/.env
```

There are two separate files:

- `.env` configures PostgreSQL, RabbitMQ, MinIO, Caddy, and the public proxy ports.
- `apps/api/.env` configures Django, workers, database and queue clients, and object storage access.

The database, RabbitMQ, and storage credentials must agree across the two files.

## 3. Configure the public URL, secrets, and TLS

Replace the sample values with the real domain and independently generated secret values.

In `.env`, set at least:

```dotenv
POSTGRES_USER=plane
POSTGRES_PASSWORD=<long-random-database-password>
POSTGRES_DB=plane

RABBITMQ_USER=plane
RABBITMQ_PASSWORD=<long-random-rabbitmq-password>
RABBITMQ_VHOST=plane

LISTEN_HTTP_PORT=80
LISTEN_HTTPS_PORT=443
SITE_ADDRESS=plane.example.com
CERT_EMAIL=ops@example.com
```

In `apps/api/.env`, use the same database and RabbitMQ values and set:

```dotenv
DEBUG=0
WEB_URL=https://plane.example.com
CORS_ALLOWED_ORIGINS=https://plane.example.com

SECRET_KEY=<unique-long-random-secret>
LIVE_SERVER_SECRET_KEY=<different-unique-long-random-secret>
```

Generate secrets with a password manager or, on Linux:

```bash
openssl rand -hex 32
```

Do not use the example passwords or placeholder keys in production. Never paste either `.env` file into support tickets, logs, or source control.

## 4. Configure object storage

### Bundled MinIO

For the MinIO container defined in the root Compose file, configure the same values in both environment files:

```dotenv
USE_MINIO=1
AWS_ACCESS_KEY_ID=<minio-access-key>
AWS_SECRET_ACCESS_KEY=<minio-secret-key>
AWS_S3_BUCKET_NAME=uploads
AWS_S3_ENDPOINT_URL=http://plane-minio:9000
```

Leave `AWS_S3_PUBLIC_ENDPOINT_URL` unset for the bundled MinIO setup. The API creates browser upload URLs through the public Caddy host, which proxies `/<bucket>/` to MinIO.

### External S3-compatible storage

Use the provider endpoint and credentials in both files, set `USE_MINIO=0`, and ensure the bucket already exists and the credentials can read, write, delete, and inspect object metadata. If the browser must use a different reachable endpoint than the API container, set:

```dotenv
AWS_S3_PUBLIC_ENDPOINT_URL=https://storage.example.com
```

The public endpoint must support browser uploads, CORS, presigned requests, and the configured maximum object size.

## 5. Configure attachment limits

The app validates attachment size before creating a presigned upload. Keep every layer aligned. For the 200 MiB limit introduced by this branch, set:

```dotenv
# .env
FILE_SIZE_LIMIT=209715200

# apps/api/.env
FILE_SIZE_LIMIT=209715200
DATA_UPLOAD_MAX_MEMORY_SIZE=5242880
```

`DATA_UPLOAD_MAX_MEMORY_SIZE` stays small because attachments use direct presigned object-storage uploads rather than passing large files through Django.

The source Compose proxy uses the root `FILE_SIZE_LIMIT`. If the separate deployment configuration patch is adopted later, also set `PROXY_BODY_SIZE_LIMIT=211812352` (202 MiB) so HTTP request overhead fits around a 200 MiB file. Configure any external load balancer, CDN, WAF, or storage-provider limit to match or exceed the proxy limit.

## 6. Validate and start

Validate variable interpolation before starting. Do not share the output of `docker compose config`, because it can include resolved secrets.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Review startup and migration logs:

```bash
docker compose logs --tail=150 migrator api worker proxy
```

After the services are running, verify the public endpoint:

```bash
curl -fI https://plane.example.com
```

Open `https://plane.example.com` in a browser, create the initial administrator account, and test an attachment upload at the configured size threshold.

## 7. Operate safely

- Back up PostgreSQL and the uploaded-object storage before every update. For bundled storage, that includes the `pgdata` and `uploads` Docker volumes.
- Monitor `api`, `worker`, `beat-worker`, `plane-db`, `plane-mq`, `plane-minio`, and `proxy` with `docker compose ps` and `docker compose logs`.
- Restrict Docker socket access, protect the host, and keep Docker images and the operating system patched.
- Update the app only from reviewed commits. Read migration output on every release.

For a normal source update:

```bash
git fetch origin
git switch vcs-dev
git pull --ff-only origin vcs-dev
docker compose up -d --build
docker compose logs --tail=150 migrator api
```

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| TLS certificate is not issued | Confirm DNS points to the host, ports 80/443 are open, `SITE_ADDRESS` is the public hostname, and `CERT_EMAIL` is valid. Inspect `docker compose logs proxy`. |
| API cannot connect to PostgreSQL or RabbitMQ | Check that hostnames are `plane-db` and `plane-mq` in `apps/api/.env`, then verify credentials match the root `.env`. |
| Browser upload URL points at an internal host | For bundled MinIO, use `USE_MINIO=1` and access Plane through Caddy. For external storage, set a reachable `AWS_S3_PUBLIC_ENDPOINT_URL`. |
| Upload is rejected as too large | Compare `FILE_SIZE_LIMIT` in both environment files, the Caddy/proxy body limit, any external proxy/CDN limit, and the object-storage policy. |
| Unuploaded attachment is retained | The scheduled cleanup retries failed storage deletions. Inspect worker and beat-worker logs, then verify object-storage delete permission. |
