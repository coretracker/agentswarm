# User Flows

## Login (Current Harness Coverage)
1. Open `/login`.
2. Enter admin email and password.
3. Click **Sign in**.
4. User is redirected to their first allowed page.

Notes:
- Default first-boot admin values come from `.env` / `.env.example`.
- This flow is validated by Playwright in `apps/web/e2e/auth.smoke.spec.ts`.

## TODO
- Task flows are documented below.
- TODO: Document repository connect/sync flow.

## Repository Configuration Flow (Current)
1. Open `/repositories`.
2. Create or edit a repository.
3. Add environment variables (plaintext key/value).
4. Add environment secrets (write-only values).
5. Add host command names that should be mounted through hostexec when enabled.
6. Save.

Notes:
- Existing secrets are shown as configured placeholders only; values are never shown again after save.
- Editing can keep an existing secret by leaving its value blank, replace it by entering a new value, or delete it by removing the row.
- Repository host commands are simple command names only. Verft mounts generated shims read-only under `/hostexec/bin` and prepends that directory to `PATH`; existing container bin directories are not overwritten.
- Repository default agent provider/model/effort values are fallback values. Task payload values win first, then matching user profile defaults, then repository defaults, then system settings.
- GitHub Integration can optionally restrict pull request feedback processing to an allowed GitHub users list; an empty list allows any non-bot GitHub user.
- New repositories default GitHub comment processing to require a configured bot mention; repository settings can disable that filter.
- GitHub Integration archives linked tasks by default when a GitHub pull request webhook reports the PR as merged; repositories can disable this in GitHub settings.
- Archived tasks are automatically deleted after the configured retention window; the setting defaults to 7 days and can be disabled.
- GitHub Integration creates or queues build-mode tasks when a `pull_request.review_requested` webhook targets the configured integration bot.
- GitHub Integration processes created or edited issue comments, pull request conversation comments, and inline pull request review comments when the comment body passes the configured bot mention and user filters.
- When a GitHub webhook author matches an active Verft user's configured GitHub username, new tasks and linked-task continuations use that user's provider, model, and effort defaults.
- New tasks created from GitHub issues use the first linked development branch as their base branch, falling back to the repository default branch when no linked branch is available.
- GitHub Integration adds an `eyes` reaction to accepted issue comments, pull request conversation comments, and inline pull request review comments, but skips the hidden task-created comment that Verft posts after opening a task.
- GitHub Integration supports separate editable agent templates for newly created GitHub tasks, feedback comments on linked tasks, and requested PR reviews. Templates can include markers such as `{{target_ref}}`, `{{title}}`, `{{title_line}}`, `{{author}}`, `{{requested_reviewer}}`, `{{url_line}}`, and `{{feedback_body}}`.
- GitHub Integration supports an editable task-created comment template for the public GitHub reply posted after Verft creates a new task. The server appends the hidden duplicate-detection marker automatically.
- Inbound Integration webhooks can keep the default `x-webhook-signature` / `x-hub-signature-256` HMAC-SHA256 headers or configure repository-specific signature header names for other vendors; each configured header can use its own write-only secret.
- Inbound Integration inbox entries show accepted, rejected, and dropped delivery statuses with a short reason when Verft refuses or cannot act on a delivery.

## Settings And Credentials Flow (Current)
1. Open `/settings`.
2. Use `General` to set the default provider, concurrent agents, access roles, and response presets.
3. Use `Harness` to define standing guidance applied to every task.
4. Use `Credentials` to set the GitHub token, OpenAI API key, and Anthropic API key. Stored credential values are write-only.
5. Use `Git` to set the Git username, optional commit author identity, and feature branch prefix. Default GitHub PAT HTTPS auth uses `x-access-token`.
6. Start the host daemon with `npm run hostexec`, then use `Hostexec` to check availability and optionally set the bearer token env var reference. Verft autodetects the default daemon URLs; repository Host Commands restrict mounted shims.
7. Use `Codex` to set default effort/model, model list, prompt magic settings, and base URL override.
8. Use `Claude Code` to set default effort/model, model list, and base URL override.
9. Open your profile to manage GitHub username linking, personal default agent settings, and personal access tokens.
10. Administrators can edit another user's default provider, model, and effort from the user's edit form.
11. Administrators manage teams alongside roles in **Settings → General**, then assign each user to zero or one team in **Users**.

Notes:
- Global and repository Harness sections display as read-only, content-sized textareas. Use the `Edit` link below a section to edit its Markdown in a right-side drawer, then apply the draft before saving the containing settings or repository form.
- The GitHub token is used for both server-side Git actions and in-agent `git pull` / `git push` inside Codex and Claude runtimes.
- Stored credential values are write-only and never returned in plaintext by the API/UI.
- Agent-created commit identity resolves from system Git author settings when configured, otherwise from the built-in Verft fallback identity.
- Codex runs use system/global OpenAI API key or Codex `auth.json`; user profiles do not store per-user Codex `auth.json`.
- Hostexec tokens are referenced by environment variable name; token values are not stored in settings. Bridge commands execute on the host with the task workspace as `cwd` and are rejected if the resolved directory escapes the workspace.
- Task runtimes receive one generated `.verft-runtime/harness.md`. Populated global harness sections appear first, followed by populated repository harness sections; both scopes are preserved.
- Team membership is dynamic: eligible teammates can list, read, and act on a member's current tasks when their own task permissions allow it and they can access the task repository. Task owners and administrators retain their existing access.

## Task Flows (New + Existing)

Notes:
- Saving a draft stores the same task definition fields used by the new task form; opening a draft reuses the same form and can create the runnable task. Task definitions do not include task-specific notes.

```mermaid
flowchart TD
  subgraph A[New Task Flow]
    A1[User opens Create Task]
    A2[Fill config: repo, title, prompt, provider]
    A3[Submit create form]
    A4[POST /tasks]
    A11[Task row created in store]
    A12[Workspace prepared]
    A13[Action enqueued via Scheduler]
    A14[Task Detail opens]
  end

  A1 --> A2 --> A3
  A3 --> A4 --> A11
  A11 --> A12 --> A13 --> A14

  subgraph B[Existing Build Flow]
    B1[Open existing task]
    B2[Click Build or send Build message]
    B3[Scheduler triggerAction build]
    B4{Can run now? active/queued/archived/pending checkpoint/terminal active}
    B5[Set queued status + enqueue]
    B6[Worker dequeues]
    B7[Status -> building]
    B8[Spawner ensures workspace clone/checkout]
    B9[Run provider build execution]
    B10[Stream logs + runs/messages]
    B11{Changes produced?}
    B12[Create pending checkpoint/change proposal]
    B13[Wait for Apply/Reject/Revert]
    B14[Apply selected checkpoint action]
    B15[Status -> done/failed/cancelled]
  end

  B1 --> B2 --> B3 --> B4
  B4 -- No --> B15
  B4 -- Yes --> B5 --> B6 --> B7 --> B8 --> B9 --> B10 --> B11
  B11 -- Yes --> B12 --> B13 --> B14 --> B15
  B11 -- No --> B15

  subgraph C[Existing Ask Flow]
    C1[Open existing task]
    C2[Click Ask or send Ask message]
    C3[Scheduler triggerAction ask]
    C4{Parallel ask allowed while already building or asking}
    C5[Run ask immediately if capacity]
    C6[Else queue ask]
    C7[Status -> asking]
    C8[Spawner ensures workspace/context]
    C9[Run provider ask execution]
    C10[Stream logs + assistant response]
    C11[Status -> answered/failed/cancelled]
  end

  C1 --> C2 --> C3 --> C4
  C4 -- Yes --> C5 --> C7
  C4 -- No --> C6 --> C7
  C7 --> C8 --> C9 --> C10 --> C11
```

## Code Flow (Implementation Path)

```mermaid
flowchart TD
  subgraph N[New Task - Code Path]
    N1[web: task-create-page.tsx submit]
    N2[web: buildTaskDefinitionInput]
    N3[web: createTaskFromDefinition]
    N4[web api: POST /tasks]
    N8[server route: routes/tasks.ts]
    N9[server: taskStore.createTask]
    N10[server: orchestrateTaskStart]
    N11[spawner.prepareWorkspace]
    N12[scheduler.triggerAction]
    N14[task persisted + events published]
  end

  N1 --> N2 --> N3 --> N4 --> N8
  N8 --> N9 --> N10 --> N11 --> N12 --> N14

  subgraph B[Existing Build - Code Path]
    B1[web: task-detail build action]
    B2[web api: POST /tasks/:id/actions action=build]
    B3[server route: routes/tasks.ts]
    B4[server: orchestrateTaskActionStart]
    B5[taskStore.markQueuedForAction]
    B6[taskQueueStore.replaceTask]
    B7[scheduler.drainQueue dequeue]
    B8[scheduler.executeTask]
    B9[spawner.run build provider]
    B10[taskStore.createRun/updateRun/appendLog]
    B11{pending checkpoint?}
    B12[taskStore upsert pending change proposal]
    B13[route handlers apply/reject/revert checkpoint]
    B14[task terminal status update + event publish]
  end

  B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7 --> B8 --> B9 --> B10 --> B11
  B11 -- Yes --> B12 --> B13 --> B14
  B11 -- No --> B14

  subgraph A[Existing Ask - Code Path]
    A1[web: task-detail ask action]
    A2[web api: POST /tasks/:id/actions action=ask]
    A3[server route: routes/tasks.ts]
    A4[server: orchestrateTaskActionStart]
    A5{parallel ask allowed}
    A6[scheduler.executeTask direct]
    A7[queue via taskQueueStore]
    A8[scheduler.executeTask from queue]
    A9[spawner.run ask provider]
    A10[taskStore.createRun/updateRun/appendLog]
    A11[task status answered/failed/cancelled + events]
  end

  A1 --> A2 --> A3 --> A4 --> A5
  A5 -- Yes --> A6 --> A9
  A5 -- No --> A7 --> A8 --> A9
  A9 --> A10 --> A11
```

## Git Flow (Task Detail)

```mermaid
flowchart TD
  G1[User opens task detail Git actions]
  G2{Action chosen}

  G3[Pull selected]
  G4[POST tasks id pull]
  G5{Mutation blocked? active run pending checkpoint terminal active archived}
  G6[shared git command handler then spawner pullTaskBranch]
  G7[task refreshed and sync counts updated]

  G8[Push selected]
  G9[POST tasks id push]
  G10{Mutation blocked? active run pending checkpoint terminal active archived}
  G11[shared git command handler then spawner pushTaskBranch]
  G12[publish task pushed event]
  G13[task refreshed and sync counts updated]

  G14[Merge selected]
  G15[GET merge preview target branch]
  G16{Merge allowed? feature branch target not same blocked checks pass}
  G17[POST tasks id merge]
  G18[shared git command handler then spawner mergeTaskBranch]
  G19[publish task merged event]
  G20[remove queued entry archive task append archived log]
  G21[return merged archived task]

  G22[Checkpoint action apply reject revert]
  G23[POST change proposals action endpoint]
  G24[checkpoint mutation transition helper executes action and refresh]
  G1 --> G2

  G2 -- Pull --> G3 --> G4 --> G5
  G5 -- No --> G6 --> G7
  G5 -- Yes --> G7

  G2 -- Push --> G8 --> G9 --> G10
  G10 -- No --> G11 --> G12 --> G13
  G10 -- Yes --> G13

  G2 -- Merge --> G14 --> G15 --> G16
  G16 -- Yes --> G17 --> G18 --> G19 --> G20 --> G21
  G16 -- No --> G21

  G2 -- Checkpoint --> G22 --> G23 --> G24
```
