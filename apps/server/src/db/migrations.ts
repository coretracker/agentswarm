export interface PostgresMigration {
  id: string;
  sql: string;
}

export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  {
    id: "20260421_01_initial_postgres_store",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS app_metadata (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roles (
        id text PRIMARY KEY,
        name text NOT NULL,
        name_key text NOT NULL UNIQUE,
        description text NOT NULL,
        scopes jsonb NOT NULL,
        allowed_providers jsonb NOT NULL,
        allowed_models jsonb NOT NULL,
        allowed_efforts jsonb NOT NULL,
        scope_version integer NOT NULL,
        is_system boolean NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS roles_name_key_idx ON roles(name_key);

      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        git_author_name text NULL,
        git_author_email text NULL,
        active boolean NOT NULL,
        password_hash text NOT NULL,
        password_salt text NOT NULL,
        last_login_at text NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
        PRIMARY KEY (user_id, role_id)
      );

      CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);

      CREATE TABLE IF NOT EXISTS repositories (
        id text PRIMARY KEY,
        name text NOT NULL,
        url text NOT NULL,
        default_branch text NOT NULL,
        webhook_url text NULL,
        webhook_enabled boolean NOT NULL,
        webhook_secret text NULL,
        webhook_last_attempt_at text NULL,
        webhook_last_status text NULL,
        webhook_last_error text NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
        default_provider text NOT NULL,
        max_agents integer NOT NULL,
        branch_prefix text NOT NULL,
        workspace_provisioning_mode text NOT NULL DEFAULT 'clone_only',
        git_username text NOT NULL,
        git_author_name text NULL,
        git_author_email text NULL,
        mcp_servers jsonb NOT NULL,
        openai_base_url text NULL,
        anthropic_base_url text NULL,
        task_prompt_magic_model text NOT NULL DEFAULT 'gpt-5.4-mini',
        task_prompt_magic_template text NOT NULL DEFAULT '',
        codex_default_model text NOT NULL,
        codex_models jsonb NOT NULL DEFAULT '[]'::jsonb,
        codex_default_effort text NOT NULL,
        claude_default_model text NOT NULL,
        claude_models jsonb NOT NULL DEFAULT '[]'::jsonb,
        claude_default_effort text NOT NULL,
        response_preference_presets jsonb NOT NULL DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS credentials (
        singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
        payload_encrypted text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id text PRIMARY KEY,
        owner_user_id text NULL,
        status text NOT NULL,
        pinned boolean NOT NULL,
        created_at text NOT NULL,
        task_data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS tasks_owner_view_idx ON tasks(owner_user_id, status, pinned DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS tasks_view_idx ON tasks(status, pinned DESC, created_at DESC);

      CREATE TABLE IF NOT EXISTS task_logs (
        log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        line text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_logs_task_id_log_id_idx ON task_logs(task_id, log_id);

      CREATE TABLE IF NOT EXISTS task_messages (
        position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        message_id text NOT NULL UNIQUE,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        created_at text NOT NULL,
        message_data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_messages_task_id_position_idx ON task_messages(task_id, position);

      CREATE TABLE IF NOT EXISTS task_runs (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at text NOT NULL,
        run_data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_runs_task_id_started_at_idx ON task_runs(task_id, started_at, id);

      CREATE TABLE IF NOT EXISTS task_run_logs (
        log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_id text NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        line text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_run_logs_run_id_log_id_idx ON task_run_logs(run_id, log_id);

      CREATE TABLE IF NOT EXISTS task_change_proposals (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status text NOT NULL,
        created_at text NOT NULL,
        resolved_at text NULL,
        proposal_data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_change_proposals_task_id_created_at_idx
        ON task_change_proposals(task_id, created_at, id);
      CREATE UNIQUE INDEX IF NOT EXISTS task_change_proposals_pending_idx
        ON task_change_proposals(task_id)
        WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS task_active_interactive_sessions (
        task_id text PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        session_data jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_interactive_terminal_transcripts (
        session_id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        transcript_data jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_drafts (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL,
        definition jsonb NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_drafts_owner_updated_at_idx ON task_drafts(owner_user_id, updated_at DESC);
    `
  },
  {
    id: "20260424_01_repository_env_vars",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS env_vars jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260427_01_user_repository_assignments",
    sql: `
      CREATE TABLE IF NOT EXISTS user_repositories (
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, repository_id)
      );

      CREATE INDEX IF NOT EXISTS user_repositories_repository_id_idx ON user_repositories(repository_id);
    `
  },
  {
    id: "20260507_01_user_agent_response_preference",
    sql: `
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS agent_response_preference jsonb NOT NULL DEFAULT '{"enabled": false, "style": null}'::jsonb;
    `
  },
  {
    id: "20260507_02_settings_response_preference_presets",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS response_preference_presets jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260509_01_user_git_author_identity",
    sql: `
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS git_author_name text NULL;

      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS git_author_email text NULL;
    `
  },
  {
    id: "20260513_01_cleanup_legacy_flow_data",
    sql: `
      UPDATE roles AS r
      SET scopes = COALESCE(
        (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT value
            FROM jsonb_array_elements_text(r.scopes) AS scope(value)
            WHERE value !~ '^flow:'
          ) AS deduped
        ),
        '[]'::jsonb
      )
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(r.scopes) AS scope(value)
        WHERE value ~ '^flow:'
      );

      UPDATE tasks
      SET task_data = task_data - 'taskMode' - 'flowId'
      WHERE task_data ? 'taskMode' OR task_data ? 'flowId';

      UPDATE task_runs
      SET run_data = run_data - 'flow'
      WHERE run_data ? 'flow';

      DROP TABLE IF EXISTS flows;
    `
  },
  {
    id: "20260520_01_repository_github_automations",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_webhook_secret text NULL;

      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_automations jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260524_01_workspace_provisioning_mode",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS workspace_provisioning_mode text NOT NULL DEFAULT 'clone_only';
    `
  },
  {
    id: "20260522_01_repository_sync_status_enabled",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS sync_status_enabled boolean NOT NULL DEFAULT false;
    `
  },
  {
    id: "20260601_01_repository_env_secrets",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS env_secrets jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260526_02_task_git_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS task_git_operations (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at text NOT NULL,
        operation_data jsonb NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_git_operations_task_id_started_at_idx
        ON task_git_operations(task_id, started_at DESC, id DESC);
    `
  },
  {
    id: "20260527_01_task_prompt_magic_settings",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS task_prompt_magic_model text NOT NULL DEFAULT 'gpt-5.4-mini';

      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS task_prompt_magic_template text NOT NULL DEFAULT '';
    `
  },
  {
    id: "20260603_01_task_drafts",
    sql: `
      CREATE TABLE IF NOT EXISTS task_drafts (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL,
        definition jsonb NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_drafts_owner_updated_at_idx ON task_drafts(owner_user_id, updated_at DESC);
    `
  },
  {
    id: "20260609_01_remove_sequences",
    sql: `
      DROP TABLE IF EXISTS sequence_runs;
      DROP TABLE IF EXISTS sequences;
    `
  },
  {
    id: "20260610_01_provider_model_settings",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS codex_models jsonb NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS claude_models jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260612_01_personal_access_tokens",
    sql: `
      CREATE TABLE IF NOT EXISTS personal_access_tokens (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        token_hash text NOT NULL UNIQUE,
        token_prefix text NOT NULL,
        scopes jsonb NOT NULL,
        expires_at text NULL,
        last_used_at text NULL,
        revoked_at text NULL,
        created_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS personal_access_tokens_user_created_at_idx
        ON personal_access_tokens(user_id, created_at DESC);
    `
  },
  {
    id: "20260622_01_migrate_terminal_permission_scope",
    sql: `
      UPDATE roles AS r
      SET scopes = COALESCE(
        (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT
              CASE value
                WHEN 'task:interactive' THEN 'task:terminal'
                ELSE value
              END AS value
            FROM jsonb_array_elements_text(r.scopes) AS scope(value)
          ) AS deduped
        ),
        '[]'::jsonb
      )
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(r.scopes) AS scope(value)
        WHERE value = 'task:interactive'
      );

      UPDATE personal_access_tokens AS t
      SET scopes = COALESCE(
        (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT
              CASE value
                WHEN 'task:interactive' THEN 'task:terminal'
                ELSE value
              END AS value
            FROM jsonb_array_elements_text(t.scopes) AS scope(value)
          ) AS deduped
        ),
        '[]'::jsonb
      )
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(t.scopes) AS scope(value)
        WHERE value = 'task:interactive'
      );
    `
  },
  {
    id: "20260623_01_remove_legacy_github_sync_columns",
    sql: `
      ALTER TABLE repositories
      DROP COLUMN IF EXISTS github_webhook_secret,
      DROP COLUMN IF EXISTS github_automations,
      DROP COLUMN IF EXISTS sync_status_enabled;
    `
  },
  {
    id: "20260623_02_repository_github_pr_feedback_webhook_secret",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_webhook_secret text NULL;
    `
  },
  {
    id: "20260624_01_repository_github_integration_bot_login",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_integration_bot_login text NULL;
    `
  },
  {
    id: "20260624_02_repository_github_pr_feedback_instructions",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_feedback_instructions text NULL;
    `
  },
  {
    id: "20260624_02a_repository_github_pr_initial_instructions",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_initial_instructions text NULL;
    `
  },
  {
    id: "20260624_02b_repository_github_pr_feedback_template_backfill",
    sql: `
      UPDATE repositories
      SET github_pr_feedback_instructions = concat(
        'A new GitHub {{target_label}} feedback item was added to linked {{target_ref}}.

Type: {{feedback_type}}
Author: @{{author}}
{{issue_title_line}}{{review_state_line}}{{file_line}}{{url_line}}{{diff_context_block}}
Feedback:
{{feedback_body}}

',
        btrim(github_pr_feedback_instructions)
      )
      WHERE github_pr_feedback_instructions IS NOT NULL
        AND btrim(github_pr_feedback_instructions) <> ''
        AND position('{{' in github_pr_feedback_instructions) = 0;
    `
  },
  {
    id: "20260624_03_repository_github_pr_require_bot_mention",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_require_bot_mention boolean NOT NULL DEFAULT false;
    `
  },
  {
    id: "20260624_04_repository_github_pr_task_owner",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_task_owner_user_id text NULL REFERENCES users(id) ON DELETE SET NULL;
    `
  },
  {
    id: "20260624_05_repository_github_pr_allowed_users",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_allowed_users jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260625_02_repository_github_pr_auto_archive_on_merge",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_auto_archive_on_merge boolean NOT NULL DEFAULT false;
    `
  },
  {
    id: "20260716_01_repository_github_pr_auto_archive_default_on",
    sql: `
      ALTER TABLE repositories
      ALTER COLUMN github_pr_auto_archive_on_merge SET DEFAULT true;
    `
  },
  {
    id: "20260626_01_repository_github_pr_review_instructions",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_review_instructions text NULL;
    `
  },
  {
    id: "20260629_01_system_git_author_identity",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS git_author_name text NULL,
      ADD COLUMN IF NOT EXISTS git_author_email text NULL;
    `
  },
  {
    id: "20260629_02_repository_mcp_servers",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS mcp_servers jsonb NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE system_settings
      ALTER COLUMN mcp_servers SET DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260629_03_settings_anthropic_base_url",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS anthropic_base_url text NULL;
    `
  },
  {
    id: "20260630_01_repository_harness_fields",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS harness_what_exists text NULL,
      ADD COLUMN IF NOT EXISTS harness_allowed_actions text NULL,
      ADD COLUMN IF NOT EXISTS harness_how_to_work text NULL,
      ADD COLUMN IF NOT EXISTS harness_definition_of_done text NULL,
      ADD COLUMN IF NOT EXISTS harness_evidence_expectations text NULL;
    `
  },
  {
    id: "20260707_01_repository_harness_not_allowed_actions",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS harness_not_allowed_actions text NULL;
    `
  },
  {
    id: "20260709_01_system_harness_fields",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS harness_what_exists text NULL,
      ADD COLUMN IF NOT EXISTS harness_allowed_actions text NULL,
      ADD COLUMN IF NOT EXISTS harness_not_allowed_actions text NULL,
      ADD COLUMN IF NOT EXISTS harness_how_to_work text NULL,
      ADD COLUMN IF NOT EXISTS harness_definition_of_done text NULL,
      ADD COLUMN IF NOT EXISTS harness_evidence_expectations text NULL;
    `
  },
  {
    id: "20260630_02_repository_github_task_created_comment_template",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS github_pr_task_created_comment_template text NULL;
    `
  },
  {
    id: "20260701_01_hostexec_bridge_settings",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS hostexec_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS hostexec_url text NULL,
      ADD COLUMN IF NOT EXISTS hostexec_bearer_token_env_var text NULL;

      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS host_commands jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "20260701_08_personal_access_token_runtime_context",
    sql: `
      ALTER TABLE personal_access_tokens
      ADD COLUMN IF NOT EXISTS runtime_context jsonb NULL;
    `
  },
  {
    id: "20260702_01_repository_default_agent_settings",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS default_provider text NULL,
      ADD COLUMN IF NOT EXISTS default_model text NULL,
      ADD COLUMN IF NOT EXISTS default_provider_profile text NULL;
    `
  },
  {
    id: "20260702_02_user_default_agent_settings",
    sql: `
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS github_username text NULL,
      ADD COLUMN IF NOT EXISTS default_provider text NULL,
      ADD COLUMN IF NOT EXISTS default_model text NULL,
      ADD COLUMN IF NOT EXISTS default_provider_profile text NULL;
    `
  },
  {
    id: "20260706_01_remove_slack_assistant_schema",
    sql: `
      DROP INDEX IF EXISTS users_slack_username_idx;
      DROP INDEX IF EXISTS slack_assistant_conversations_user_idx;
      DROP INDEX IF EXISTS slack_assistant_conversations_slack_context_idx;

      DROP TABLE IF EXISTS slack_assistant_conversations;

      ALTER TABLE users
      DROP COLUMN IF EXISTS slack_username;

      ALTER TABLE repositories
      DROP COLUMN IF EXISTS slack_bot_token,
      DROP COLUMN IF EXISTS slack_signing_secret,
      DROP COLUMN IF EXISTS slack_agent_mcp_servers,
      DROP COLUMN IF EXISTS slack_last_event_at,
      DROP COLUMN IF EXISTS slack_last_event_status,
      DROP COLUMN IF EXISTS slack_last_event_type,
      DROP COLUMN IF EXISTS slack_last_event_error;

      ALTER TABLE system_settings
      DROP COLUMN IF EXISTS slack_bot_token,
      DROP COLUMN IF EXISTS slack_signing_secret,
      DROP COLUMN IF EXISTS slack_agent_mcp_servers,
      DROP COLUMN IF EXISTS slack_last_event_at,
      DROP COLUMN IF EXISTS slack_last_event_status,
      DROP COLUMN IF EXISTS slack_last_event_type,
      DROP COLUMN IF EXISTS slack_last_event_error,
      DROP COLUMN IF EXISTS slack_assistant_provider,
      DROP COLUMN IF EXISTS slack_assistant_model,
      DROP COLUMN IF EXISTS slack_harness_what_exists,
      DROP COLUMN IF EXISTS slack_harness_allowed_actions,
      DROP COLUMN IF EXISTS slack_harness_how_to_work,
      DROP COLUMN IF EXISTS slack_harness_definition_of_done,
      DROP COLUMN IF EXISTS slack_harness_evidence_expectations;
    `
  },
  {
    id: "20260707_01_repository_slack_thread_integration",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS slack_signing_secret text NULL,
      ADD COLUMN IF NOT EXISTS slack_bot_token text NULL,
      ADD COLUMN IF NOT EXISTS slack_channel_id text NULL,
      ADD COLUMN IF NOT EXISTS slack_initial_instructions text NULL,
      ADD COLUMN IF NOT EXISTS slack_feedback_instructions text NULL,
      ADD COLUMN IF NOT EXISTS slack_task_created_reply_template text NULL,
      ADD COLUMN IF NOT EXISTS slack_task_owner_user_id text NULL;
    `
  },
  {
    id: "20260710_01_archived_task_auto_delete_settings",
    sql: `
      ALTER TABLE system_settings
      ADD COLUMN IF NOT EXISTS archived_task_auto_delete_enabled boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS archived_task_auto_delete_days integer NOT NULL DEFAULT 7;
    `
  },
  {
    id: "20260713_01_task_external_links",
    sql: `
      CREATE TABLE IF NOT EXISTS task_external_links (
        task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        repo_id text NOT NULL,
        target_type text NOT NULL,
        target_id text NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (repo_id, target_type, target_id)
      );

      CREATE INDEX IF NOT EXISTS task_external_links_task_id_idx ON task_external_links(task_id);
    `
  },
  {
    id: "20260714_01_remove_snippets",
    sql: `
      UPDATE roles AS r
      SET scopes = COALESCE(
        (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT value
            FROM jsonb_array_elements_text(r.scopes) AS scope(value)
            WHERE value !~ '^(snippet|preset):'
          ) AS deduped
        ),
        '[]'::jsonb
      )
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(r.scopes) AS scope(value)
        WHERE value ~ '^(snippet|preset):'
      );

      DROP INDEX IF EXISTS snippets_updated_at_idx;
      DROP TABLE IF EXISTS snippets;
    `
  },
  {
    id: "20260714_02_remove_notes",
    sql: `
      UPDATE tasks
      SET task_data = task_data - 'notes'
      WHERE task_data ? 'notes';

      UPDATE task_drafts
      SET definition = definition - 'notes'
      WHERE definition ? 'notes';

      DROP TABLE IF EXISTS user_notes;

      ALTER TABLE system_settings
      DROP COLUMN IF EXISTS workspace_notes,
      DROP COLUMN IF EXISTS workspace_notes_updated_at;
    `
  },
  {
    id: "20260716_01_repository_github_pr_require_bot_mention_default",
    sql: `
      ALTER TABLE repositories
      ALTER COLUMN github_pr_require_bot_mention SET DEFAULT true;
    `
  },
  {
    id: "20260717_01_integration_rules_and_webhook_inbox",
    sql: `
      CREATE TABLE IF NOT EXISTS integration_rules (
        id text PRIMARY KEY,
        repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        filter jsonb NOT NULL DEFAULT '{"conditions":[]}'::jsonb,
        mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        execution jsonb NULL,
        correlation_field text NULL,
        task_owner_user_id text NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS integration_rules_repository_id_idx ON integration_rules(repository_id);

      CREATE TABLE IF NOT EXISTS webhook_inbox (
        id text PRIMARY KEY,
        repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        headers jsonb NOT NULL DEFAULT '{}'::jsonb,
        body jsonb NOT NULL DEFAULT '{}'::jsonb,
        source_ip text NULL,
        matched_rule_id text NULL,
        task_id text NULL,
        received_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS webhook_inbox_repository_id_received_at_idx ON webhook_inbox(repository_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS webhook_inbox_unmatched_idx ON webhook_inbox(repository_id, received_at DESC) WHERE matched_rule_id IS NULL;

      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS inbound_webhook_secret text NULL;
    `
  },
  {
    id: "20260721_01_inbound_webhook_signature_headers",
    sql: `
      ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS inbound_webhook_signature_headers jsonb NOT NULL DEFAULT '["x-webhook-signature","x-hub-signature-256"]'::jsonb;
    `
  }
];
