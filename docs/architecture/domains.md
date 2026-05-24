# Domains

This section lists major code domains visible in the repository.

## UI Domain
- Path: `apps/web`
- Purpose: pages, UI components, API client, realtime client hooks.

## API and Orchestration Domain
- Path: `apps/server`
- Purpose: authentication, task routes, scheduling, spawning agent runtime work, repository and settings flows.

## Shared Contract Domain
- Path: `packages/shared-types`
- Purpose: shared types between UI and server.

## Runtime Domain
- Paths:
  - `agent-runtime-codex`
  - `agent-runtime-claude`
  - `tools/codex-web-terminal`
- Purpose: execute provider tools inside containers and support interactive terminal sessions.

## Deployment Domain
- Paths:
  - `docker-compose.yml`
  - `deploy/nginx.conf`
  - `agentswarm.sh`
- Purpose: local stack orchestration and service routing.

## TODO
- TODO: Add an explicit data lifecycle map (task creation -> queue -> run -> checkpoint) with links to exact server modules.
