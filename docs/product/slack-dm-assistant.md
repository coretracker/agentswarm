# Slack DM Assistant

## Scope
The Slack DM assistant is a globally configured Slack bot entry point for simple 1:1 assistant conversations.

In the first implementation slice:
- Users add a Slack username to their profile.
- Workspace admins configure a Slack bot token and signing secret in Settings -> Integrations.
- Workspace admins can configure extra Slack agent MCP servers in Settings -> Integrations.
- Slack sends DM events to the global Slack events URL.
- AgentSwarm verifies Slack signatures, resolves the Slack sender to an active AgentSwarm user by username, persists a detached conversation record, and posts a reply back to the same DM.
- AgentSwarm starts a detached Codex or Claude runtime using the system default provider and the matched user's runtime credentials.
- The runtime receives Slack conversation context, a small assistant workspace, persistent provider state, automatic AgentSwarm MCP access scoped through the matched user, and any configured extra Slack agent MCP servers.
- Slack DM conversations are stored separately from normal AgentSwarm tasks.

## Setup
1. Add the Slack username in the AgentSwarm profile modal.
2. Open Settings -> Integrations and save a Slack bot token plus Slack signing secret.
3. Optionally add extra Slack agent MCP servers in Settings -> Integrations. AgentSwarm MCP is always added automatically.
4. Copy the global Slack events URL into the Slack app event subscription.
5. Subscribe the Slack app to direct message events.

Slack credentials are never returned by settings read APIs. The UI only shows whether the bot token and signing secret are configured.

The Slack bot needs `chat:write`, `users:read`, `im:history`, and `reactions:write` bot token scopes. Reinstall the Slack app after changing scopes.

Settings -> Integrations shows the latest signed Slack event result, including received, ignored, and failed events.

## Task Isolation
Plain Slack chat messages do not create AgentSwarm tasks, task runs, task logs, checkpoints, or proposals.

The Slack DM conversation store is separate from task storage so the Slack assistant can keep long-lived DM context without changing normal task workflows.

## Runtime Behavior
Each Slack DM message is acknowledged quickly, then the assistant response is produced in the background and posted back to Slack.

The first runtime slice starts a provider invocation per user message instead of keeping an always-on container. Provider state and the Slack conversation transcript are persisted separately, so the next message can continue the same long-lived DM context.

If a conversation has no user message for 5 minutes, AgentSwarm marks the active Slack assistant runtime state as stopped for idle timeout. The next user message starts a fresh provider invocation against the same persisted conversation context.

## Current Limits
- Repository/channel mapping is not part of v1.
- Slack channel workflows are not part of v1.
- Slack assistant execution is one provider run per message with persisted state, not a resident interactive container.
- Matching is by Slack username. Storing Slack workspace and user IDs after first contact is a future hardening step.
