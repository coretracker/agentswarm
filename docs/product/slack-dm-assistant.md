# Slack DM Assistant

The Slack DM assistant is separate from repositories and tasks. An active Verft user links an immutable Slack workspace ID and user ID in Profile. Signed direct messages from that identity use one persistent assistant session until the user clears it.

## User Controls

- Link or clear Slack workspace/user IDs.
- Select provider, model, and effort through existing profile defaults.
- View recent prompts, replies, tool/runtime errors, and session state.
- Clear the active session. Clearing removes provider continuation state and creates an audit event.

## Administrator Controls

Settings -> Slack contains the DM assistant policy:

- Global enable/disable.
- Provider and model allowlists.
- MCP permission-scope allowlist.
- Maximum concurrent assistant runs.
- Audit-event retention.

Administrator policy is an upper bound. Profile choices cannot enable a disallowed provider, model, or MCP permission.

## Runtime and Isolation

Each message runs in the unified provider toolbox with a persistent assistant state directory and a workspace that is not attached to any repository. Verft MCP receives a short-lived user-scoped personal access token. Messages for one session are serialized. Slack event IDs are recorded to suppress retries.

No `Task`, task run, checkpoint, proposal, or repository workspace is created for ordinary assistant messages.

## Slack App Requirements

Use the global `/slack/events` URL. Configure the signing secret and bot token in Settings -> Slack. Subscribe to direct-message `message.im` events and grant `chat:write` plus the Slack scopes required to receive those events.
