# Execution Plan Draft

## Title
- Restructure Settings UI for Human-Friendly Configuration

## Goal
- Make the settings page easier to understand and safer to operate by grouping settings by user intent instead of internal implementation.
- Reduce the chance that users change runtime, credential, role, or provider defaults without understanding the impact.
- Align the settings UI with the move toward repository-owned integrations such as repository-level MCP servers.

## Current State
- `SettingsPage` is a single long page with a large "general settings" form plus separate credentials, roles, and response preference sections.
- Runtime controls, provider defaults, OpenAI gateway settings, prompt magic, Git settings, and global MCP servers are all saved through one form.
- Credentials are separate but visually adjacent to unrelated settings.
- Role management and response preference presets live below the core runtime settings.
- The settings page copy is technically accurate but not very task-oriented.
- Global MCP servers appear under system settings, which conflicts with the planned repository-level MCP workflow.

## Design Direction
- Organize settings around decisions users are trying to make:
- "Runtime defaults" for how tasks start and how many agents can run.
- "Models" for Codex/Claude model lists and default model choices.
- "Connections" for credentials, Git identity, provider gateway URLs, and links to repository-owned integrations.
- "Access control" for roles and capability allowlists.
- "Response presets" for communication defaults.
- Keep dangerous or high-impact actions visually contained and clearly labeled.
- Prefer smaller forms with their own Save button over one large form that saves unrelated concerns together.
- Use tabs for top-level grouping so users only see the settings category they are currently working on.
- Tabs should reduce visual noise, avoid a long scrolling settings page, and make ownership boundaries clearer.
- Every editable tab should have a clearly visible primary Save button in a predictable place.

## Acceptance Criteria
- Settings page is split into clear tabs with short human-readable descriptions.
- Each tab contains only one coherent settings category or a small set of tightly related categories.
- Each tab has a focused save action and does not require saving unrelated settings.
- Save buttons are visible without hunting: use a sticky footer or consistent top-right/tab-footer placement for long forms.
- Tabs with unsaved changes clearly indicate dirty state and warn before switching away or closing if changes would be lost.
- Save success/error feedback is scoped to the tab that was saved.
- Credentials are grouped together inside Connections and remain write-only.
- Provider model configuration is easier to scan and does not dominate the first viewport.
- Runtime controls clearly explain impact: default provider, default effort, concurrency.
- Git identity and external credentials are grouped under connections instead of being mixed into runtime/model defaults.
- Global MCP server editing is removed from system settings once repository-level MCP is implemented.
- Until repository-level MCP lands, any existing MCP section is labeled as temporary/legacy and appears under Connections, not as a primary workflow.
- Access control and response presets remain available but are not buried below unrelated operational settings.
- Read-only users can still understand settings without seeing misleading edit affordances.
- Mobile and desktop layouts remain usable without nested cards or cramped controls.

## Non-goals
- No redesign of task creation or repository editor in this draft, except for links/copy that guide users there.
- No new permissions model.
- No credential storage redesign.
- No model discovery backend changes unless needed to support clearer UI.
- No implementation of repository-level MCP in this task; that has its own draft.

## Proposed Information Architecture
- Tab: Overview
- Shows health/status summaries: credentials configured/missing, default provider, concurrent agents, data store backend, and links to key tabs.
- Keeps this read-only except for navigation.

- Tab: Runtime Defaults
- Default provider.
- Concurrent agents.
- Default effort per provider.
- Task Prompt Magic model/template.
- Feature branch prefix.

- Tab: Models
- Codex model list and default model.
- Claude model list and default model.
- Auto-fill actions.
- Experimental Claude warning stays here.

- Tab: Connections
- GitHub token.
- OpenAI API key.
- Codex `auth.json`.
- Anthropic API key.
- Clear actions grouped next to each credential.
- Git username.
- OpenAI base URL override.
- Explains that repository-specific integrations are configured from each repository.
- Links to repositories list/editor.
- After repository-level MCP is implemented, no global MCP editor appears here.

- Tab: Access Control
- Roles table and role editor.
- Capability allowlists.

- Tab: Response Presets
- Existing response preference preset table/editor.

## Affected Files
- `apps/web/components/settings-page.tsx`
- `apps/web/src/api/client.ts` only if smaller partial-update helpers are useful.
- `apps/web/src/hooks/useSettings.ts`
- `apps/server/src/routes/settings.ts` only if splitting save endpoints improves clarity.
- `packages/shared-types/src/index.ts` if settings contracts are narrowed.
- `apps/web/components/repositories-page.tsx` or repository editor links if needed.
- `docs/development/setup.md`
- `docs/product/user-flows.md`

## Step-by-Step Plan
1. Inventory current settings fields and ownership.
- List every `SystemSettings` field displayed in `SettingsPage`.
- Classify each field as runtime default, model catalog, connection/credential, access control, response preset, or repository integration.
- Identify settings that should move out of system settings, especially MCP.

2. Choose section navigation.
- Use tabs as the top-level settings navigation.
- Choose concise tab labels that fit on desktop and remain usable on mobile.
- Consider grouping less frequent tabs under a `More` overflow only if the tab row becomes crowded.
- Keep each section full-width and unframed except for individual forms/tables.
- Avoid nested cards and long all-in-one forms.

3. Split form state by section.
- Separate runtime defaults, models, connections, roles, and response preset forms.
- Keep save buttons local to each section.
- Add a consistent Save button location for each editable tab.
- Track dirty state per tab so users can see which category has unsaved changes.
- Preserve existing validation and write-only credential behavior.

4. Improve labels and helper copy.
- Replace implementation-oriented labels where needed.
- Use impact-focused descriptions, for example "Limits how many task containers can run at the same time."
- Clearly mark experimental Claude settings.

5. Remove or quarantine global MCP settings.
- If repository-level MCP is implemented first, remove MCP settings from this page entirely.
- If this UI cleanup lands first, place MCP under a temporary "Legacy integrations" section with copy that it will move to repositories.
- Do not present global MCP as a normal recommended workflow.

6. Preserve permissions and read-only mode.
- Read-only users should see values and descriptions, not broken or confusing controls.
- Keep `settings:edit` enforcement unchanged.

7. Add focused tests/manual checks.
- TypeScript lint for web.
- If UI tests exist or are added, cover section rendering and form submit payloads.
- Manually verify desktop and mobile layout for text overflow and control grouping.

8. Update docs.
- Update setup and product docs to describe where runtime defaults, credentials, access roles, and repository integrations live.

## Human-Gated Flow Evidence
- Requirements Read: TODO
- Requirements Understood: TODO
- Repository Research Complete: TODO
- Uncertainties Logged: TODO
- Human Review Completed: TODO
- User Approval To Start: TODO
- Baseline Checks Run: TODO
- Visible Task List Updated: TODO
- Task-Level Tests/Lint/Build: TODO
- Self Review Complete: TODO
- Code Review Complete: TODO
- Final Verification Complete: TODO
- Security/Privacy Review Complete: TODO
- Docs/Changelog Updated: TODO

## Validation Commands
- `npm run lint -w @agentswarm/web`
- `npm run lint -w @agentswarm/server`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Splitting one large form into several saves can accidentally drop fields if update payloads are not partial-safe.
- Moving MCP out of settings before repository-level MCP is ready can hide an existing workflow.
- Too many tabs can make settings feel fragmented or cramped on mobile; labels need to stay short and categories need to be stable.
- Copy changes can accidentally imply different permission or credential behavior than the backend enforces.

## Rollback Plan
- Restore the current single-page `SettingsPage` layout.
- Keep any extracted helper components only if they are behavior-neutral.
- Restore the current global MCP settings card until repository-level MCP is ready.

## Open Questions
- Should each tab map to URL state so refresh/deep links preserve the selected category?
- Should runtime/provider/Git settings save through one endpoint with partial payloads, or should the server expose narrower endpoints?
- Should repository integrations appear as a settings section with links, or only live under repositories?
- Should response presets stay in settings or move to a dedicated "Presets" area later?

## Completion Notes
- Draft only.
