import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { CreateFlowInput, FlowDefinition, UpdateFlowInput } from "@agentswarm/shared-types";

const FLOW_KEY_PREFIX = "agentswarm:flow:";
const FLOW_IDS_KEY = "agentswarm:flow_ids";

const nowIso = (): string => new Date().toISOString();

export interface FlowStore {
  createFlow(input: CreateFlowInput): Promise<FlowDefinition>;
  listFlows(): Promise<FlowDefinition[]>;
  getFlow(flowId: string): Promise<FlowDefinition | null>;
  updateFlow(flowId: string, input: UpdateFlowInput): Promise<FlowDefinition | null>;
  deleteFlow(flowId: string): Promise<boolean>;
}

export class RedisFlowStore implements FlowStore {
  constructor(private readonly redis: Redis) {}

  private flowKey(flowId: string): string {
    return `${FLOW_KEY_PREFIX}${flowId}`;
  }

  private buildFlow(
    input: CreateFlowInput | UpdateFlowInput,
    current?: Pick<FlowDefinition, "id" | "createdAt">
  ): FlowDefinition {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      definitionJson: input.definitionJson.trim(),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createFlow(input: CreateFlowInput): Promise<FlowDefinition> {
    const flow = this.buildFlow(input);
    await this.redis
      .multi()
      .set(this.flowKey(flow.id), JSON.stringify(flow))
      .sadd(FLOW_IDS_KEY, flow.id)
      .exec();
    return flow;
  }

  async listFlows(): Promise<FlowDefinition[]> {
    const ids = await this.redis.smembers(FLOW_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.flowKey(id));
    }

    const result = await pipeline.exec();
    const flows: FlowDefinition[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        flows.push(JSON.parse(raw) as FlowDefinition);
      }
    }

    return flows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getFlow(flowId: string): Promise<FlowDefinition | null> {
    const raw = await this.redis.get(this.flowKey(flowId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as FlowDefinition;
  }

  async updateFlow(flowId: string, input: UpdateFlowInput): Promise<FlowDefinition | null> {
    const current = await this.getFlow(flowId);
    if (!current) {
      return null;
    }

    const next = this.buildFlow(input, current);
    await this.redis.set(this.flowKey(flowId), JSON.stringify(next));
    return next;
  }

  async deleteFlow(flowId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.flowKey(flowId));
    if (!exists) {
      return false;
    }

    await this.redis.multi().del(this.flowKey(flowId)).srem(FLOW_IDS_KEY, flowId).exec();
    return true;
  }
}

export class PostgresFlowStore implements FlowStore {
  constructor(private readonly pool: Pool) {}

  private buildFlow(
    input: CreateFlowInput | UpdateFlowInput,
    current?: Pick<FlowDefinition, "id" | "createdAt">
  ): FlowDefinition {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      definitionJson: input.definitionJson.trim(),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createFlow(input: CreateFlowInput): Promise<FlowDefinition> {
    const flow = this.buildFlow(input);
    await this.pool.query(
      `
        INSERT INTO flows (id, name, description, definition_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [flow.id, flow.name, flow.description, flow.definitionJson, flow.createdAt, flow.updatedAt]
    );
    return flow;
  }

  async listFlows(): Promise<FlowDefinition[]> {
    const result = await this.pool.query(
      "SELECT id, name, description, definition_json, created_at, updated_at FROM flows ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ""),
      definitionJson: String(row.definition_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  async getFlow(flowId: string): Promise<FlowDefinition | null> {
    const result = await this.pool.query(
      "SELECT id, name, description, definition_json, created_at, updated_at FROM flows WHERE id = $1",
      [flowId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          description: String(row.description ?? ""),
          definitionJson: String(row.definition_json),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }
      : null;
  }

  async updateFlow(flowId: string, input: UpdateFlowInput): Promise<FlowDefinition | null> {
    const current = await this.getFlow(flowId);
    if (!current) {
      return null;
    }

    const next = this.buildFlow(input, current);
    await this.pool.query(
      `
        UPDATE flows
        SET name = $2, description = $3, definition_json = $4, updated_at = $5
        WHERE id = $1
      `,
      [flowId, next.name, next.description, next.definitionJson, next.updatedAt]
    );
    return next;
  }

  async deleteFlow(flowId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM flows WHERE id = $1", [flowId]);
    return (result.rowCount ?? 0) > 0;
  }
}
