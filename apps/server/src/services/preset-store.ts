import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Preset, Repository, TaskDefinitionInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";

const PRESET_KEY_PREFIX = "agentswarm:preset:";
const PRESET_IDS_KEY = "agentswarm:preset_ids";

const nowIso = (): string => new Date().toISOString();

const derivePresetName = (definition: TaskDefinitionInput): string => {
  if (definition.sourceType === "blank") {
    return definition.title.trim();
  }

  if (definition.sourceType === "issue") {
    return definition.title?.trim() || `Issue #${definition.issueNumber}`;
  }

  return definition.title?.trim() || `PR #${definition.pullRequestNumber}`;
};

export class PresetStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private presetKey(presetId: string): string {
    return `${PRESET_KEY_PREFIX}${presetId}`;
  }

  private buildPreset(
    definition: TaskDefinitionInput,
    repository: Repository,
    current?: Pick<Preset, "id" | "createdAt">
  ): Preset {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: derivePresetName(definition),
      repoId: repository.id,
      repoName: repository.name,
      sourceType: definition.sourceType,
      definition,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createPreset(definition: TaskDefinitionInput, repository: Repository): Promise<Preset> {
    const preset = this.buildPreset(definition, repository);
    await this.redis
      .multi()
      .set(this.presetKey(preset.id), JSON.stringify(preset))
      .sadd(PRESET_IDS_KEY, preset.id)
      .exec();
    await this.eventBus.publish({ type: "preset:created", payload: preset });
    return preset;
  }

  async listPresets(): Promise<Preset[]> {
    const ids = await this.redis.smembers(PRESET_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.presetKey(id));
    }

    const result = await pipeline.exec();
    const presets: Preset[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        presets.push(JSON.parse(raw) as Preset);
      }
    }

    return presets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPreset(presetId: string): Promise<Preset | null> {
    const raw = await this.redis.get(this.presetKey(presetId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as Preset;
  }

  async updatePreset(presetId: string, definition: TaskDefinitionInput, repository: Repository): Promise<Preset | null> {
    const current = await this.getPreset(presetId);
    if (!current) {
      return null;
    }

    const next = this.buildPreset(definition, repository, current);
    await this.redis.set(this.presetKey(presetId), JSON.stringify(next));
    await this.eventBus.publish({ type: "preset:updated", payload: next });
    return next;
  }

  async deletePreset(presetId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.presetKey(presetId));
    if (!exists) {
      return false;
    }

    await this.redis.multi().del(this.presetKey(presetId)).srem(PRESET_IDS_KEY, presetId).exec();
    await this.eventBus.publish({ type: "preset:deleted", payload: { id: presetId } });
    return true;
  }
}
