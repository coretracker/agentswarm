import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  CreateSequenceInput,
  Sequence,
  SequenceExecutionMode,
  SequenceRun,
  SequenceRunStep,
  SequenceStep,
  SnippetVariable,
  UpdateSequenceInput
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { parseJsonColumn } from "../lib/postgres.js";

const SEQUENCE_KEY_PREFIX = "agentswarm:sequence:";
const SEQUENCE_IDS_KEY = "agentswarm:sequence_ids";
const SEQUENCE_RUN_KEY_PREFIX = "agentswarm:sequence_run:";
const SEQUENCE_RUN_BY_TASK_KEY_PREFIX = "agentswarm:sequence_run_by_task:";
const SNIPPET_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SNIPPET_VARIABLE_MAX_COUNT = 100;
const SNIPPET_VARIABLE_NAME_MAX_LENGTH = 128;
const SNIPPET_VARIABLE_TEXT_MAX_LENGTH = 200;
const SNIPPET_VARIABLE_DEFAULT_VALUE_MAX_LENGTH = 2000;
const NEWLINE_PATTERN = /\r?\n/u;

const nowIso = (): string => new Date().toISOString();
const normalizeExecutionMode = (value: unknown): SequenceExecutionMode =>
  value === "approve_before_continuing" ? "approve_before_continuing" : "auto_apply_changes";

const normalizeRunStatus = (value: unknown): SequenceRun["status"] =>
  value === "succeeded" || value === "failed" || value === "waiting_for_approval" || value === "waiting_for_checkpoint_resolution"
    ? value
    : "running";

const normalizeSnippetVariables = (value: unknown): SnippetVariable[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const variables: SnippetVariable[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || name.length > SNIPPET_VARIABLE_NAME_MAX_LENGTH || !SNIPPET_VARIABLE_NAME_PATTERN.test(name) || seen.has(name)) {
      continue;
    }

    const type = record.type === "multiline" ? "multiline" : "text";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const defaultValue = typeof record.defaultValue === "string" ? record.defaultValue : "";
    const normalizedDefaultValue = type === "text" ? (defaultValue.split(NEWLINE_PATTERN)[0] ?? "") : defaultValue;
    variables.push({
      name,
      type,
      title: title.slice(0, SNIPPET_VARIABLE_TEXT_MAX_LENGTH),
      description: description.slice(0, SNIPPET_VARIABLE_TEXT_MAX_LENGTH),
      defaultValue: normalizedDefaultValue.slice(0, SNIPPET_VARIABLE_DEFAULT_VALUE_MAX_LENGTH)
    });
    seen.add(name);
    if (variables.length >= SNIPPET_VARIABLE_MAX_COUNT) {
      break;
    }
  }

  return variables;
};

const normalizeSteps = (value: unknown): SequenceStep[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const steps: SequenceStep[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const type = record.type === "snippet" ? "snippet" : "inline";
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    const snippetId = typeof record.snippetId === "string" && record.snippetId.trim() ? record.snippetId.trim() : undefined;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step_${index + 1}`;
    steps.push({
      id,
      type,
      prompt,
      ...(snippetId ? { snippetId } : {})
    });
  }
  return steps;
};

const normalizeRunSteps = (value: unknown, stepCount: number, initialPrompts?: string[]): SequenceRunStep[] => {
  if (!Array.isArray(value)) {
    return Array.from({ length: stepCount }, (_, index) => ({
      index,
      prompt: typeof initialPrompts?.[index] === "string" ? initialPrompts[index]!.trim() : "",
      state: "pending",
      taskRunId: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null
    }));
  }
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const state =
      record.state === "running" || record.state === "succeeded" || record.state === "failed" || record.state === "skipped"
        ? record.state
        : "pending";
    return [
      {
        index: typeof record.index === "number" ? Math.max(0, Math.floor(record.index)) : index,
        prompt: typeof record.prompt === "string" ? record.prompt : "",
        state,
        taskRunId: typeof record.taskRunId === "string" && record.taskRunId.trim() ? record.taskRunId.trim() : null,
        errorMessage: typeof record.errorMessage === "string" && record.errorMessage.trim() ? record.errorMessage.trim() : null,
        startedAt: typeof record.startedAt === "string" && record.startedAt.trim() ? record.startedAt : null,
        finishedAt: typeof record.finishedAt === "string" && record.finishedAt.trim() ? record.finishedAt : null
      }
    ];
  });
};

export interface SequenceStore {
  createSequence(input: CreateSequenceInput): Promise<Sequence>;
  listSequences(): Promise<Sequence[]>;
  getSequence(sequenceId: string): Promise<Sequence | null>;
  updateSequence(sequenceId: string, input: UpdateSequenceInput): Promise<Sequence | null>;
  deleteSequence(sequenceId: string): Promise<boolean>;
  createRun(input: {
    sequenceId: string;
    taskId: string;
    stepCount: number;
    stepPrompts?: string[];
    executionMode?: SequenceExecutionMode;
  }): Promise<SequenceRun>;
  getRun(runId: string): Promise<SequenceRun | null>;
  getRunForTask(taskId: string): Promise<SequenceRun | null>;
  claimRunWaitingForApproval(runId: string): Promise<{ run: SequenceRun; approvedStepIndex: number } | null>;
  updateRun(
    runId: string,
    patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
  ): Promise<SequenceRun | null>;
}

export class RedisSequenceStore implements SequenceStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private sequenceKey(sequenceId: string): string {
    return `${SEQUENCE_KEY_PREFIX}${sequenceId}`;
  }

  private runKey(runId: string): string {
    return `${SEQUENCE_RUN_KEY_PREFIX}${runId}`;
  }

  private runByTaskKey(taskId: string): string {
    return `${SEQUENCE_RUN_BY_TASK_KEY_PREFIX}${taskId}`;
  }

  private buildSequence(
    input: CreateSequenceInput | UpdateSequenceInput,
    current?: Pick<Sequence, "id" | "createdAt" | "executionMode">
  ): Sequence {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      executionMode: input.executionMode ? normalizeExecutionMode(input.executionMode) : (current?.executionMode ?? "auto_apply_changes"),
      steps: normalizeSteps(input.steps),
      variables: normalizeSnippetVariables(input.variables),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createSequence(input: CreateSequenceInput): Promise<Sequence> {
    const sequence = this.buildSequence(input);
    await this.redis
      .multi()
      .set(this.sequenceKey(sequence.id), JSON.stringify(sequence))
      .sadd(SEQUENCE_IDS_KEY, sequence.id)
      .exec();
    await this.eventBus.publish({ type: "sequence:created", payload: sequence });
    return sequence;
  }

  async listSequences(): Promise<Sequence[]> {
    const ids = await this.redis.smembers(SEQUENCE_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.sequenceKey(id));
    }

    const result = await pipeline.exec();
    const sequences: Sequence[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as Sequence;
        sequences.push({
          ...parsed,
          executionMode: normalizeExecutionMode(parsed.executionMode),
          steps: normalizeSteps(parsed.steps),
          variables: normalizeSnippetVariables(parsed.variables)
        });
      }
    }
    return sequences.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSequence(sequenceId: string): Promise<Sequence | null> {
    const raw = await this.redis.get(this.sequenceKey(sequenceId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Sequence;
    return {
      ...parsed,
      executionMode: normalizeExecutionMode(parsed.executionMode),
      steps: normalizeSteps(parsed.steps),
      variables: normalizeSnippetVariables(parsed.variables)
    };
  }

  async updateSequence(sequenceId: string, input: UpdateSequenceInput): Promise<Sequence | null> {
    const current = await this.getSequence(sequenceId);
    if (!current) {
      return null;
    }
    const next = this.buildSequence(input, current);
    await this.redis.set(this.sequenceKey(sequenceId), JSON.stringify(next));
    await this.eventBus.publish({ type: "sequence:updated", payload: next });
    return next;
  }

  async deleteSequence(sequenceId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.sequenceKey(sequenceId));
    if (!exists) {
      return false;
    }
    await this.redis.multi().del(this.sequenceKey(sequenceId)).srem(SEQUENCE_IDS_KEY, sequenceId).exec();
    await this.eventBus.publish({ type: "sequence:deleted", payload: { id: sequenceId } });
    return true;
  }

  async createRun(input: {
    sequenceId: string;
    taskId: string;
    stepCount: number;
    stepPrompts?: string[];
    executionMode?: SequenceExecutionMode;
  }): Promise<SequenceRun> {
    const run: SequenceRun = {
      id: nanoid(),
      sequenceId: input.sequenceId,
      taskId: input.taskId,
      status: "running",
      executionMode: normalizeExecutionMode(input.executionMode),
      failPolicy: "fail_fast",
      stepCount: input.stepCount,
      waitingForApprovalAfterStepIndex: null,
      failedStepIndex: null,
      startedAt: nowIso(),
      finishedAt: null,
      steps: normalizeRunSteps(null, input.stepCount, input.stepPrompts)
    };

    await this.redis
      .multi()
      .set(this.runKey(run.id), JSON.stringify(run))
      .set(this.runByTaskKey(run.taskId), run.id)
      .exec();
    await this.eventBus.publish({ type: "sequence:run_updated", payload: run });
    return run;
  }

  async getRun(runId: string): Promise<SequenceRun | null> {
    const raw = await this.redis.get(this.runKey(runId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SequenceRun;
    const normalizedStepCount = typeof parsed.stepCount === "number" && Number.isFinite(parsed.stepCount) ? Math.max(0, Math.floor(parsed.stepCount)) : 0;
    return {
      ...parsed,
      status: normalizeRunStatus(parsed.status),
      executionMode: normalizeExecutionMode(parsed.executionMode),
      stepCount: normalizedStepCount,
      waitingForApprovalAfterStepIndex:
        typeof parsed.waitingForApprovalAfterStepIndex === "number" ? Math.max(0, Math.floor(parsed.waitingForApprovalAfterStepIndex)) : null,
      steps: normalizeRunSteps(parsed.steps, normalizedStepCount)
    };
  }

  async getRunForTask(taskId: string): Promise<SequenceRun | null> {
    const runId = await this.redis.get(this.runByTaskKey(taskId));
    if (!runId) {
      return null;
    }
    return this.getRun(runId);
  }

  async claimRunWaitingForApproval(runId: string): Promise<{ run: SequenceRun; approvedStepIndex: number } | null> {
    const key = this.runKey(runId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.redis.watch(key);
      const raw = await this.redis.get(key);
      if (!raw) {
        await this.redis.unwatch();
        return null;
      }

      const parsed = JSON.parse(raw) as SequenceRun;
      const normalizedStepCount = typeof parsed.stepCount === "number" && Number.isFinite(parsed.stepCount) ? Math.max(0, Math.floor(parsed.stepCount)) : 0;
      const current: SequenceRun = {
        ...parsed,
        status: normalizeRunStatus(parsed.status),
        executionMode: normalizeExecutionMode(parsed.executionMode),
        stepCount: normalizedStepCount,
        waitingForApprovalAfterStepIndex:
          typeof parsed.waitingForApprovalAfterStepIndex === "number" ? Math.max(0, Math.floor(parsed.waitingForApprovalAfterStepIndex)) : null,
        steps: normalizeRunSteps(parsed.steps, normalizedStepCount)
      };

      const approvedStepIndex = current.waitingForApprovalAfterStepIndex;
      if (current.status !== "waiting_for_approval" || approvedStepIndex === null) {
        await this.redis.unwatch();
        return null;
      }

      const next: SequenceRun = {
        ...current,
        status: "running",
        waitingForApprovalAfterStepIndex: null
      };
      const result = await this.redis.multi().set(key, JSON.stringify(next)).exec();
      if (result === null) {
        continue;
      }
      await this.eventBus.publish({ type: "sequence:run_updated", payload: next });
      return {
        run: next,
        approvedStepIndex
      };
    }

    return null;
  }

  async updateRun(
    runId: string,
    patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
  ): Promise<SequenceRun | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }
    const next: SequenceRun = {
      ...current,
      ...patch,
      status: patch.status ? normalizeRunStatus(patch.status) : current.status,
      waitingForApprovalAfterStepIndex:
        typeof patch.waitingForApprovalAfterStepIndex === "number"
          ? Math.max(0, Math.floor(patch.waitingForApprovalAfterStepIndex))
          : patch.waitingForApprovalAfterStepIndex === null
            ? null
            : current.waitingForApprovalAfterStepIndex,
      steps: patch.steps ? normalizeRunSteps(patch.steps, current.stepCount) : current.steps
    };
    await this.redis.set(this.runKey(runId), JSON.stringify(next));
    await this.eventBus.publish({ type: "sequence:run_updated", payload: next });
    return next;
  }
}

export class PostgresSequenceStore implements SequenceStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus
  ) {}

  private buildSequence(
    input: CreateSequenceInput | UpdateSequenceInput,
    current?: Pick<Sequence, "id" | "createdAt" | "executionMode">
  ): Sequence {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      executionMode: input.executionMode ? normalizeExecutionMode(input.executionMode) : (current?.executionMode ?? "auto_apply_changes"),
      steps: normalizeSteps(input.steps),
      variables: normalizeSnippetVariables(input.variables),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createSequence(input: CreateSequenceInput): Promise<Sequence> {
    const sequence = this.buildSequence(input);
    await this.pool.query(
      `
        INSERT INTO sequences (id, name, execution_mode, steps, variables, created_at, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
      `,
      [sequence.id, sequence.name, sequence.executionMode, JSON.stringify(sequence.steps), JSON.stringify(sequence.variables), sequence.createdAt, sequence.updatedAt]
    );
    await this.eventBus.publish({ type: "sequence:created", payload: sequence });
    return sequence;
  }

  async listSequences(): Promise<Sequence[]> {
    const result = await this.pool.query("SELECT id, name, execution_mode, steps, variables, created_at, updated_at FROM sequences ORDER BY updated_at DESC");
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      executionMode: normalizeExecutionMode(row.execution_mode),
      steps: normalizeSteps(row.steps),
      variables: normalizeSnippetVariables(row.variables),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  async getSequence(sequenceId: string): Promise<Sequence | null> {
    const result = await this.pool.query(
      "SELECT id, name, execution_mode, steps, variables, created_at, updated_at FROM sequences WHERE id = $1",
      [sequenceId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          executionMode: normalizeExecutionMode(row.execution_mode),
          steps: normalizeSteps(row.steps),
          variables: normalizeSnippetVariables(row.variables),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }
      : null;
  }

  async updateSequence(sequenceId: string, input: UpdateSequenceInput): Promise<Sequence | null> {
    const current = await this.getSequence(sequenceId);
    if (!current) {
      return null;
    }
    const next = this.buildSequence(input, current);
    await this.pool.query(
      `
        UPDATE sequences
        SET name = $2, execution_mode = $3, steps = $4::jsonb, variables = $5::jsonb, updated_at = $6
        WHERE id = $1
      `,
      [sequenceId, next.name, next.executionMode, JSON.stringify(next.steps), JSON.stringify(next.variables), next.updatedAt]
    );
    await this.eventBus.publish({ type: "sequence:updated", payload: next });
    return next;
  }

  async deleteSequence(sequenceId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM sequences WHERE id = $1", [sequenceId]);
    if (result.rowCount === 0) {
      return false;
    }
    await this.eventBus.publish({ type: "sequence:deleted", payload: { id: sequenceId } });
    return true;
  }

  async createRun(input: {
    sequenceId: string;
    taskId: string;
    stepCount: number;
    stepPrompts?: string[];
    executionMode?: SequenceExecutionMode;
  }): Promise<SequenceRun> {
    const run: SequenceRun = {
      id: nanoid(),
      sequenceId: input.sequenceId,
      taskId: input.taskId,
      status: "running",
      executionMode: normalizeExecutionMode(input.executionMode),
      failPolicy: "fail_fast",
      stepCount: input.stepCount,
      waitingForApprovalAfterStepIndex: null,
      failedStepIndex: null,
      startedAt: nowIso(),
      finishedAt: null,
      steps: normalizeRunSteps(null, input.stepCount, input.stepPrompts)
    };
    await this.pool.query(
      `
        INSERT INTO sequence_runs (id, sequence_id, task_id, started_at, run_data)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [run.id, run.sequenceId, run.taskId, run.startedAt, JSON.stringify(run)]
    );
    await this.eventBus.publish({ type: "sequence:run_updated", payload: run });
    return run;
  }

  async getRun(runId: string): Promise<SequenceRun | null> {
    const result = await this.pool.query("SELECT run_data FROM sequence_runs WHERE id = $1", [runId]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const run = parseJsonColumn<SequenceRun>(row.run_data);
    const normalizedStepCount = typeof run.stepCount === "number" && Number.isFinite(run.stepCount) ? Math.max(0, Math.floor(run.stepCount)) : 0;
    return {
      ...run,
      status: normalizeRunStatus(run.status),
      executionMode: normalizeExecutionMode(run.executionMode),
      stepCount: normalizedStepCount,
      waitingForApprovalAfterStepIndex:
        typeof run.waitingForApprovalAfterStepIndex === "number" ? Math.max(0, Math.floor(run.waitingForApprovalAfterStepIndex)) : null,
      steps: normalizeRunSteps(run.steps, normalizedStepCount)
    };
  }

  async getRunForTask(taskId: string): Promise<SequenceRun | null> {
    const result = await this.pool.query(
      "SELECT run_data FROM sequence_runs WHERE task_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1",
      [taskId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const run = parseJsonColumn<SequenceRun>(row.run_data);
    const normalizedStepCount = typeof run.stepCount === "number" && Number.isFinite(run.stepCount) ? Math.max(0, Math.floor(run.stepCount)) : 0;
    return {
      ...run,
      status: normalizeRunStatus(run.status),
      executionMode: normalizeExecutionMode(run.executionMode),
      stepCount: normalizedStepCount,
      waitingForApprovalAfterStepIndex:
        typeof run.waitingForApprovalAfterStepIndex === "number" ? Math.max(0, Math.floor(run.waitingForApprovalAfterStepIndex)) : null,
      steps: normalizeRunSteps(run.steps, normalizedStepCount)
    };
  }

  async claimRunWaitingForApproval(runId: string): Promise<{ run: SequenceRun; approvedStepIndex: number } | null> {
    const result = await this.pool.query<{
      run_data: unknown;
      approved_step_index: number;
    }>(
      `
        WITH selected AS (
          SELECT
            id,
            run_data,
            (run_data->>'waitingForApprovalAfterStepIndex')::int AS approved_step_index
          FROM sequence_runs
          WHERE id = $1
            AND run_data->>'status' = 'waiting_for_approval'
            AND jsonb_typeof(run_data->'waitingForApprovalAfterStepIndex') = 'number'
          FOR UPDATE
        ),
        updated AS (
          UPDATE sequence_runs AS sequence_runs
          SET run_data = jsonb_set(
            jsonb_set(selected.run_data, '{status}', '"running"'::jsonb, false),
            '{waitingForApprovalAfterStepIndex}',
            'null'::jsonb,
            false
          )
          FROM selected
          WHERE sequence_runs.id = selected.id
          RETURNING sequence_runs.run_data, selected.approved_step_index
        )
        SELECT run_data, approved_step_index
        FROM updated
      `,
      [runId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const run = parseJsonColumn<SequenceRun>(row.run_data);
    const normalizedStepCount = typeof run.stepCount === "number" && Number.isFinite(run.stepCount) ? Math.max(0, Math.floor(run.stepCount)) : 0;
    const nextRun: SequenceRun = {
      ...run,
      status: normalizeRunStatus(run.status),
      executionMode: normalizeExecutionMode(run.executionMode),
      stepCount: normalizedStepCount,
      waitingForApprovalAfterStepIndex:
        typeof run.waitingForApprovalAfterStepIndex === "number" ? Math.max(0, Math.floor(run.waitingForApprovalAfterStepIndex)) : null,
      steps: normalizeRunSteps(run.steps, normalizedStepCount)
    };
    await this.eventBus.publish({ type: "sequence:run_updated", payload: nextRun });
    return {
      run: nextRun,
      approvedStepIndex: Math.max(0, Math.floor(Number(row.approved_step_index)))
    };
  }

  async updateRun(
    runId: string,
    patch: Partial<Pick<SequenceRun, "status" | "failedStepIndex" | "finishedAt" | "steps" | "waitingForApprovalAfterStepIndex">>
  ): Promise<SequenceRun | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }
    const next: SequenceRun = {
      ...current,
      ...patch,
      status: patch.status ? normalizeRunStatus(patch.status) : current.status,
      waitingForApprovalAfterStepIndex:
        typeof patch.waitingForApprovalAfterStepIndex === "number"
          ? Math.max(0, Math.floor(patch.waitingForApprovalAfterStepIndex))
          : patch.waitingForApprovalAfterStepIndex === null
            ? null
            : current.waitingForApprovalAfterStepIndex,
      steps: patch.steps ? normalizeRunSteps(patch.steps, current.stepCount) : current.steps
    };
    await this.pool.query("UPDATE sequence_runs SET started_at = $2, run_data = $3::jsonb WHERE id = $1", [
      runId,
      next.startedAt,
      JSON.stringify(next)
    ]);
    await this.eventBus.publish({ type: "sequence:run_updated", payload: next });
    return next;
  }
}
