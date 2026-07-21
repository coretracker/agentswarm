import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import type { Repository, WebhookInboxEntry } from "@verft/shared-types";
import { registerInboundWebhookRoutes } from "./inbound-webhooks.js";

const now = "2026-07-20T00:00:00.000Z";

const repository: Repository = {
  id: "repo-1",
  name: "repo",
  url: "https://github.com/acme/repo.git",
  defaultBranch: "develop",
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  hostCommands: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  githubPrWebhookSecretConfigured: false,
  inboundWebhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: now,
  updatedAt: now
};

const createTestApp = (secret: string | null, inboundWebhookSignatureHeaders?: string[]) => {
  const app = Fastify();
  const insertedEntries: WebhookInboxEntry[] = [];
  const testRepository = { ...repository, inboundWebhookSignatureHeaders };

  app.addContentTypeParser("application/json", { parseAs: "string" }, (request: FastifyRequest, body: string | Buffer, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, rawBody.trim().length > 0 ? JSON.parse(rawBody) : {});
  });

  registerInboundWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async (repositoryId: string) => (repositoryId === repository.id ? testRepository : null),
      getRepositoryInboundWebhookSecret: async () => secret
    } as never,
    integrationRuleStore: {
      listRules: async () => []
    } as never,
    webhookInboxStore: {
      insertEntry: async (entry: { repositoryId: string; headers: Record<string, string>; body: unknown; sourceIp: string | null }) => {
        const inboxEntry: WebhookInboxEntry = {
          id: `entry-${insertedEntries.length + 1}`,
          repositoryId: entry.repositoryId,
          headers: entry.headers,
          body: entry.body,
          sourceIp: entry.sourceIp,
          matchedRuleId: null,
          taskId: null,
          receivedAt: now
        };
        insertedEntries.push(inboxEntry);
        return inboxEntry;
      },
      deleteOldEntries: async () => 0
    } as never,
    taskStore: {} as never,
    scheduler: {} as never,
    settingsStore: {} as never,
    spawner: {} as never,
    userStore: {} as never
  });

  return { app, insertedEntries };
};

test("inbound webhook validation HEAD returns ok for an existing repository", async () => {
  const { app, insertedEntries } = createTestApp("webhook-secret");

  const response = await app.inject({
    method: "HEAD",
    url: "/integrations/webhooks/repo-1"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "");
  assert.equal(insertedEntries.length, 0);

  await app.close();
});

test("inbound webhook validation HEAD returns not found for unknown repositories", async () => {
  const { app, insertedEntries } = createTestApp(null);

  const response = await app.inject({
    method: "HEAD",
    url: "/integrations/webhooks/missing"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body, "");
  assert.equal(insertedEntries.length, 0);

  await app.close();
});

test("inbound webhook accepts unsigned deliveries when no secret is configured", async () => {
  const { app, insertedEntries } = createTestApp(null);

  const response = await app.inject({
    method: "POST",
    url: "/integrations/webhooks/repo-1",
    payload: { event: "build" }
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { received: true, matched: false });
  assert.equal(insertedEntries.length, 1);
  assert.deepEqual(insertedEntries[0]?.body, { event: "build" });

  await app.close();
});

test("inbound webhook rejects unsigned deliveries when a secret is configured", async () => {
  const { app, insertedEntries } = createTestApp("webhook-secret");

  const response = await app.inject({
    method: "POST",
    url: "/integrations/webhooks/repo-1",
    payload: { event: "build" }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { message: "Invalid webhook signature." });
  assert.equal(insertedEntries.length, 0);

  await app.close();
});

test("inbound webhook accepts GitHub sha256 signature header", async () => {
  const secret = "webhook-secret";
  const { app, insertedEntries } = createTestApp(secret);
  const payload = JSON.stringify({ action: "created", comment: { body: "build this" } });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/integrations/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { received: true, matched: false });
  assert.equal(insertedEntries.length, 1);
  assert.deepEqual(insertedEntries[0]?.body, { action: "created", comment: { body: "build this" } });

  await app.close();
});

test("inbound webhook accepts configured vendor signature header with bare sha256 digest", async () => {
  const secret = "webhook-secret";
  const { app, insertedEntries } = createTestApp(secret, ["x-linear-signature"]);
  const payload = JSON.stringify({ action: "created", data: { issue: { id: "LIN-123" } } });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  const response = await app.inject({
    method: "POST",
    url: "/integrations/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-linear-signature": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { received: true, matched: false });
  assert.equal(insertedEntries.length, 1);

  await app.close();
});

test("inbound webhook accepts configured vendor signature header with keyed digest", async () => {
  const secret = "webhook-secret";
  const { app, insertedEntries } = createTestApp(secret, ["x-vendor-signature"]);
  const payload = JSON.stringify({ event: "deployment" });
  const digest = createHmac("sha256", secret).update(payload).digest("hex");

  const response = await app.inject({
    method: "POST",
    url: "/integrations/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-vendor-signature": `t=123,v1=${digest}`
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { received: true, matched: false });
  assert.equal(insertedEntries.length, 1);

  await app.close();
});
