# Frontend Guide

The frontend is a Next.js 14 App Router application in `apps/web`. It uses React 18, Ant Design, Socket.IO client, Monaco, xterm, React Markdown, Mermaid, and diff rendering libraries.

Primary evidence: `apps/web/package.json`, `apps/web/app/layout.tsx`, `apps/web/components/app-shell.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/hooks/*`, `apps/web/components/task-detail-page.tsx`, `apps/web/components/repository-editor-page.tsx`, `apps/web/components/settings-page.tsx`, and `packages/shared-types/src/index.ts`.

## App shell and routing

`apps/web/app/layout.tsx` wraps every page with:

- `AntdRegistry` for Ant Design with Next.js;
- `ThemeProvider`;
- `AuthProvider`;
- `AppShell`.

App Router route files are mostly thin adapters that render components from `apps/web/components`:

- `/login` → login page;
- `/tasks`, `/tasks/board`, `/tasks/new`, `/tasks/[id]`, `/tasks/[id]/terminal`;
- `/repositories`, `/repositories/new`, `/repositories/[id]/edit`;
- `/settings`, provider setup terminal pages;
- `/snippets`, `/profile`, `/users`.

`apps/web/app/page.tsx` redirects signed-out users to login and authenticated users to their first allowed route.

## Auth, access, and shell state

`apps/web/components/auth-provider.tsx` fetches `/auth/session`, exposes `login`, `logout`, session refresh/mutation, and client-side `can()`/`canAll()` helpers.

`apps/web/src/auth/access.ts` centralizes navigation routes, required scopes, selected menu key, terminal fullscreen detection, public paths, and default route resolution. `AppShell` uses this to hide inaccessible navigation and redirect unauthenticated or unauthorized users.

Important: this is UI gating only. Backend route capability checks remain the real security boundary.

`AppShell` also manages:

- desktop/mobile sidebar layout;
- sticky nav and right-side notes panel;
- task browser notifications;
- theme mode selection;
- fullscreen terminal layout exceptions;
- autosaved user notes via `api.getUserNotes` / `api.updateUserNotes`.

## API client

`apps/web/src/api/client.ts` is the frontend’s central HTTP wrapper. It:

- builds public API URLs through `apps/web/src/lib/public-url.ts`;
- sends cookies with `credentials: "include"`;
- sets JSON content type when a body exists;
- disables fetch caching;
- throws `ApiError(status, message)` using server JSON `{message}` when present;
- exposes typed methods for auth, users, roles, snippets, tasks, task history, Git/workspace endpoints, repositories, settings, credentials, provider models, hostexec, notes, prompt magic, and diff assist.

Most endpoint payload/response types come from `@verft/shared-types`; keep client methods aligned with server routes and shared contracts.

## Realtime hooks

`apps/web/src/hooks/useSocket.ts` maintains one shared Socket.IO websocket per authenticated session key (`user.id:expiresAt`) with cookies enabled.

Live data hooks include:

- `useTasks`: list tasks and handle `task:created`, `task:updated`, `task:deleted`.
- `useTask`: fetch one task, merge/refetch after `task:updated`, append logs, handle delete.
- `useTaskMessages`: paginated messages plus message create/update/delete events.
- `useTaskRuns`: paginated runs and run/log events.
- `useTaskChangeProposals`: paginated checkpoint/change proposal events.
- `useRepositories`: repository list plus created/updated/deleted events.
- `useSettings`: settings plus `settings:updated`.

Some hooks intentionally catch errors and fall back to non-loading/empty state; this can hide backend or websocket failures during UI changes.

## Major UI surfaces

### Tasks

- `tasks-page.tsx`: active/archived task table with filters and archive/delete actions.
- `tasks-kanban-board-page.tsx`: Kanban board over workflow statuses; drag/drop updates task state.
- `task-create-page.tsx` and `task-create-modal.tsx`: full-page and modal task creation/draft flows.
- `task-definition-fields.tsx`: shared task form fields for repo, provider/model/profile, branch strategy, snippets, prompt attachments, task type, prompt magic.
- `task-detail-page.tsx`: central high-complexity screen for task config, messages, runs/timeline, logs, diffs, checkpoints, Git operations, workspace files, terminal launch/transcripts, follow-ups, and linked subtasks.
- `task-files-tab.tsx`, `workspace-file-preview-modal.tsx`, `checkpoint-file-editor-modal.tsx`: workspace and checkpoint file interactions.
- `task-interactive-terminal-view.tsx` and terminal route: browser terminal.

### Repositories

- `repositories-page.tsx`: repository list.
- `repository-editor-page.tsx`: repository metadata, env vars/secrets and file uploads, MCP servers, host commands, GitHub integration, Slack integration, harness guidance, default agent settings, assigned users.

Repository editor changes often require matching backend validation/persistence updates and shared type updates.

### Settings, users, snippets, profile

- `settings-page.tsx`: system settings, global harness, Git settings, hostexec availability, credentials, Slack, provider model/defaults, roles, response preference presets. It has complex dirty-state and unsaved-change handling.
- `users-page.tsx`: user/admin management.
- `snippets-page.tsx` and `snippet-editor-page.tsx`: reusable prompt templates.
- `profile-page.tsx`: user profile, GitHub username, personal defaults, PATs.

## Shared types and UI helpers

The web imports task/repository/settings contracts, provider options, labels, lifecycle helpers, and permission scopes from `@verft/shared-types`. Notable helpers include provider/model/effort option functions and task status/workflow/execution label helpers.

Do not duplicate enums or labels in web code unless they are purely visual; prefer adding shared helpers when both server and web need the concept.

## Frontend tests

`apps/web/package.json` runs Node tests for utility-level behavior:

- `src/utils/task-history.test.ts`
- `src/utils/snippets.test.ts`
- `src/utils/diff.test.ts`
- `src/utils/workspace-file-links.test.ts`
- `src/utils/task-lifecycle-view-model.test.ts`
- `src/utils/task-run-timeline.test.ts`
- `src/utils/harness-editor.test.ts`

Playwright auth smoke coverage lives in `apps/web/e2e/auth.smoke.spec.ts` and is described by `docs/development/testing.md`.

Commands:

```bash
npm run test -w @verft/web
npm run lint -w @verft/web
npm run build -w @verft/web
```

## Change watchpoints

- `task-detail-page.tsx` is very large and stateful. Prefer extracting helpers/components with targeted tests when changing cross-cutting behavior.
- Keep `TaskDefinitionInput` vs `CreateTaskInput` mapping straight: form uses `model`; API create uses `modelOverride`.
- Test repository editor changes around env secrets, file secrets, MCP servers, host commands, and template defaults.
- Test settings changes around dirty state, credential set/clear, provider model fallback/source handling, roles, and response presets.
- Realtime updates can race with refetches and local state; verify duplicate/lost message/run/proposal behavior when changing hooks.
