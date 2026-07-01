# Slack DM Assistant

## Scope
The Slack DM assistant is a repository-configured Slack bot entry point for simple 1:1 assistant conversations.

In the first implementation slice:
- Users add a Slack username to their profile.
- Repository owners configure a Slack bot token and signing secret in the repository Slack integration section.
- Slack sends DM events to the repository Slack events URL.
- AgentSwarm verifies Slack signatures, resolves the Slack sender to an active AgentSwarm user by username, persists a detached conversation record, and posts a reply back to the same DM.
- Slack DM conversations are stored separately from normal AgentSwarm tasks.

## Setup
1. Add the Slack username in the AgentSwarm profile modal.
2. Open the repository editor and save a Slack bot token plus Slack signing secret in Slack Integration.
3. Copy the repository Slack events URL into the Slack app event subscription.
4. Subscribe the Slack app to direct message events.

Slack credentials are never returned by repository read APIs. The UI only shows whether the bot token and signing secret are configured.

## Task Isolation
Plain Slack chat messages do not create AgentSwarm tasks, task runs, task logs, checkpoints, or proposals.

The Slack DM conversation store is separate from task storage so the Slack assistant can keep long-lived DM context without changing normal task workflows.

## Current Limits
- Repository/channel mapping is not part of v1.
- Slack channel workflows are not part of v1.
- The detached Codex/Claude container runner and 5-minute idle container stop are planned follow-up work after the signed event and conversation foundation.
- Matching is by Slack username. Storing Slack workspace and user IDs after first contact is a future hardening step.
