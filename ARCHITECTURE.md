# Architecture Overview

This repository is a TypeScript monorepo for AgentSwarm.

## Main Parts
- `apps/server`: backend API and task orchestration service.
- `apps/web`: frontend web app.
- `packages/shared-types`: shared data types used by server and web.
- `agent-runtime-*`: container runtimes used to execute agent tasks.
- `deploy/nginx.conf`: reverse proxy for web + API.

## Runtime Shape
- Docker Compose runs Redis, Postgres, server, web, and nginx proxy.
- The server starts task runs and launches provider runtime containers.
- The web app calls backend APIs and receives real-time updates.

## Evidence
- Root docs: `README.md`
- Compose: `docker-compose.yml`
- Server entrypoint: `apps/server/src/index.ts`
- Web layout entrypoint: `apps/web/app/layout.tsx`

## More Detail
- [Architecture docs index](docs/architecture/index.md)
