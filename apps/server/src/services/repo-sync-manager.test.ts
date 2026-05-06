import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RepoSyncManager } from "./repo-sync-manager.js";

describe("RepoSyncManager", () => {
  it("uses cold fetch ttl for first run decision", () => {
    let now = 0;
    const manager = new RepoSyncManager({ jitterPercent: 0 }, () => now);

    const decision = manager.decide("/repo-cache/repos/example", "run");
    assert.equal(decision.shouldFetch, true);
    assert.equal(decision.fetchMaxAgeMs, 60 * 60 * 1000);
  });

  it("enforces status fetch floor and write-path strict freshness", () => {
    let now = 0;
    const manager = new RepoSyncManager({ jitterPercent: 0 }, () => now);
    const repoPath = "/repo-cache/repos/example";

    manager.markFetched(repoPath);

    now = 4 * 60 * 1000;
    const statusBeforeFloor = manager.decide(repoPath, "status");
    assert.equal(statusBeforeFloor.shouldFetch, false);
    assert.equal(statusBeforeFloor.fetchMaxAgeMs, 5 * 60 * 1000);

    now = 5 * 60 * 1000;
    const statusAtFloor = manager.decide(repoPath, "status");
    assert.equal(statusAtFloor.shouldFetch, true);

    manager.markFetched(repoPath);

    now += 119 * 1000;
    const pushFreshEnough = manager.decide(repoPath, "push");
    assert.equal(pushFreshEnough.shouldFetch, false);
    assert.equal(pushFreshEnough.fetchMaxAgeMs, 2 * 60 * 1000);

    now += 1_000;
    const pushStale = manager.decide(repoPath, "push");
    assert.equal(pushStale.shouldFetch, true);
  });

  it("applies prune ttl independently", () => {
    let now = 0;
    const manager = new RepoSyncManager({ jitterPercent: 0 }, () => now);
    const repoPath = "/repo-cache/repos/example";

    const firstDecision = manager.decide(repoPath, "status");
    assert.equal(firstDecision.shouldPrune, true);

    manager.markPruned(repoPath);

    now = 5 * 60 * 60 * 1000;
    const beforePruneTtl = manager.decide(repoPath, "status");
    assert.equal(beforePruneTtl.shouldPrune, false);

    now = 6 * 60 * 60 * 1000;
    const atPruneTtl = manager.decide(repoPath, "status");
    assert.equal(atPruneTtl.shouldPrune, true);
  });
});
