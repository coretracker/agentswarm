export type RepoSyncOperation =
  | "run"
  | "ask"
  | "workspace_prepare"
  | "status"
  | "push"
  | "pull"
  | "merge"
  | "merge_preview";

interface RepoSyncState {
  lastAccessAt: number | null;
  lastFetchAt: number | null;
  lastPruneAt: number | null;
}

export interface RepoSyncDecision {
  shouldFetch: boolean;
  shouldPrune: boolean;
  fetchMaxAgeMs: number;
  pruneMaxAgeMs: number;
}

export interface RepoSyncManagerOptions {
  hotWindowMs: number;
  warmWindowMs: number;
  hotFetchTtlMs: number;
  warmFetchTtlMs: number;
  coldFetchTtlMs: number;
  statusFetchFloorMs: number;
  writeFetchMaxAgeMs: number;
  pruneTtlMs: number;
  jitterPercent: number;
}

const DEFAULT_OPTIONS: RepoSyncManagerOptions = {
  hotWindowMs: 10 * 60 * 1000,
  warmWindowMs: 2 * 60 * 60 * 1000,
  hotFetchTtlMs: 2 * 60 * 1000,
  warmFetchTtlMs: 15 * 60 * 1000,
  coldFetchTtlMs: 60 * 60 * 1000,
  statusFetchFloorMs: 5 * 60 * 1000,
  writeFetchMaxAgeMs: 2 * 60 * 1000,
  pruneTtlMs: 6 * 60 * 60 * 1000,
  jitterPercent: 0.15
};

const writeOperations = new Set<RepoSyncOperation>(["push", "pull", "merge", "merge_preview"]);

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export class RepoSyncManager {
  private readonly stateByRepoPath = new Map<string, RepoSyncState>();
  private readonly options: RepoSyncManagerOptions;

  constructor(
    options: Partial<RepoSyncManagerOptions> = {},
    private readonly now: () => number = () => Date.now()
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  decide(repoPath: string, operation: RepoSyncOperation): RepoSyncDecision {
    const state = this.getOrCreateState(repoPath);
    const now = this.now();

    const fetchMaxAgeMs = this.resolveFetchMaxAgeMs(repoPath, operation, state, now);
    const pruneMaxAgeMs = this.applyJitterMs(repoPath, this.options.pruneTtlMs);

    const shouldFetch = state.lastFetchAt === null || now - state.lastFetchAt >= fetchMaxAgeMs;
    const shouldPrune = state.lastPruneAt === null || now - state.lastPruneAt >= pruneMaxAgeMs;

    state.lastAccessAt = now;

    return {
      shouldFetch,
      shouldPrune,
      fetchMaxAgeMs,
      pruneMaxAgeMs
    };
  }

  markFetched(repoPath: string): void {
    const state = this.getOrCreateState(repoPath);
    const now = this.now();
    state.lastFetchAt = now;
    state.lastAccessAt = now;
  }

  markPruned(repoPath: string): void {
    const state = this.getOrCreateState(repoPath);
    const now = this.now();
    state.lastPruneAt = now;
    state.lastAccessAt = now;
  }

  clear(repoPath: string): void {
    this.stateByRepoPath.delete(repoPath);
  }

  getState(repoPath: string): Readonly<RepoSyncState> {
    const state = this.getOrCreateState(repoPath);
    return {
      lastAccessAt: state.lastAccessAt,
      lastFetchAt: state.lastFetchAt,
      lastPruneAt: state.lastPruneAt
    };
  }

  private getOrCreateState(repoPath: string): RepoSyncState {
    const existing = this.stateByRepoPath.get(repoPath);
    if (existing) {
      return existing;
    }

    const created: RepoSyncState = {
      lastAccessAt: null,
      lastFetchAt: null,
      lastPruneAt: null
    };
    this.stateByRepoPath.set(repoPath, created);
    return created;
  }

  private resolveFetchMaxAgeMs(repoPath: string, operation: RepoSyncOperation, state: RepoSyncState, now: number): number {
    if (writeOperations.has(operation)) {
      return this.options.writeFetchMaxAgeMs;
    }

    const idleDurationMs = state.lastAccessAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - state.lastAccessAt);

    const baseTtlMs =
      idleDurationMs <= this.options.hotWindowMs
        ? this.options.hotFetchTtlMs
        : idleDurationMs <= this.options.warmWindowMs
          ? this.options.warmFetchTtlMs
          : this.options.coldFetchTtlMs;

    const jitteredTtlMs = this.applyJitterMs(repoPath, baseTtlMs);
    if (operation === "status") {
      return Math.max(jitteredTtlMs, this.options.statusFetchFloorMs);
    }

    return jitteredTtlMs;
  }

  private applyJitterMs(repoPath: string, baseMs: number): number {
    const jitterPercent = Math.max(0, Math.min(0.49, this.options.jitterPercent));
    if (jitterPercent === 0) {
      return baseMs;
    }

    const normalized = hashString(repoPath) / 0xffffffff;
    const factor = 1 - jitterPercent + normalized * (2 * jitterPercent);
    return Math.max(1_000, Math.round(baseMs * factor));
  }
}
