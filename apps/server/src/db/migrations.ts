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

      CREATE TABLE IF NOT EXISTS snippets (
        id text PRIMARY KEY,
        name text NOT NULL,
        content text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE INDEX IF NOT EXISTS snippets_updated_at_idx ON snippets(updated_at DESC);

      CREATE TABLE IF NOT EXISTS system_settings (
        singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
        default_provider text NOT NULL,
        max_agents integer NOT NULL,
        branch_prefix text NOT NULL,
        git_username text NOT NULL,
        mcp_servers jsonb NOT NULL,
        openai_base_url text NULL,
        codex_default_model text NOT NULL,
        codex_default_effort text NOT NULL,
        claude_default_model text NOT NULL,
        claude_default_effort text NOT NULL
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
  }
];
