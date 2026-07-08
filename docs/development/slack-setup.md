# Slack Setup

Verft uses one Slack app configuration for the whole deployment.

## Global App Settings
Configure app-level Slack credentials in `Settings -> Slack`:

- Event URL: copy the global `/slack/events` URL shown in Settings and use it as the Slack app Event Subscriptions request URL.
- Signing Secret: paste the Slack app signing secret.
- Bot Token: paste the Slack bot token used for thread replies.

Credentials are write-only. Verft stores them encrypted and only returns configured or missing status.

The legacy `/slack/events/:repositoryId` route remains for compatibility with older Slack app request URLs. New Slack apps should use `/slack/events`.

## Repository Settings
Configure repository-specific Slack behavior in the repository editor:

- Slack Channel ID: the `C...` or `G...` channel ID this repository listens to.
- Slack-created task owner.
- Slack task-created reply template.
- Slack initial and feedback instructions.

Incoming Slack events are verified with the global signing secret, then routed to the repository whose Slack Channel ID matches the event channel. Repository Slack credentials are no longer used.

## Migration From Repository Credentials
Automatic migration is intentionally not performed because existing repositories may contain different Slack signing secrets or bot tokens, and choosing one globally could silently bind Verft to the wrong Slack app.

For existing installations:

1. Open each repository Slack tab and note the repository Slack Channel ID.
2. Open `Settings -> Slack` and configure the signing secret and bot token from the Slack app Verft should use.
3. In Slack Event Subscriptions, replace any repository-scoped request URL with the global `/slack/events` URL.
4. Keep each repository Slack Channel ID configured in the repository editor.
