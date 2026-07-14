import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import * as Sentry from "@sentry/node";
import { Server as SocketIOServer } from "socket.io";
import type { RealtimeEvent } from "@verft/shared-types";
import { AUTO_RUN_POSTGRES_MIGRATIONS, env } from "./config/env.js";
import { createAuthService } from "./lib/auth.js";
import { createPostgresPool, runPostgresMigrations } from "./lib/postgres.js";
import { createRedisClients } from "./lib/redis.js";
import { EventBus } from "./lib/events.js";
import { createPostgresStores } from "./services/create-postgres-stores.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { SpawnerService } from "./services/spawner.js";
import { SchedulerService } from "./services/scheduler.js";
import { WebhookDeliveryService } from "./services/webhook-delivery-service.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRepositoryRoutes } from "./routes/repositories.js";
import { registerGitHubPrWebhookRoutes } from "./routes/github-pr-webhooks.js";
import { registerSlackWebhookRoutes } from "./routes/slack-webhooks.js";
import { attachTaskInteractiveTerminalUpgrade } from "./lib/task-interactive-terminal.js";
import { attachSettingsProviderTerminalUpgrade } from "./lib/settings-provider-terminal.js";
import { registerMcpRoutes } from "./mcp/server.js";

const readHeaderValue = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]?.trim();
    return first && first.length > 0 ? first : null;
  }
  return null;
};

const getOperationIdFromHeaders = (headers: Record<string, string | string[] | undefined>): string | null =>
  readHeaderValue(headers["x-operation-id"]) ?? readHeaderValue(headers["x-agent-operation-id"]);

const bootstrap = async (): Promise<void> => {
  const sentryEnabled = env.SENTRY_ENABLED && env.SENTRY_DSN.trim().length > 0;
  if (sentryEnabled) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 1
    });
  }

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "verft-server" }
    },
    disableRequestLogging: true,
    requestIdHeader: "x-request-id",
    genReqId: (rawRequest) => readHeaderValue(rawRequest.headers["x-request-id"]) ?? randomUUID(),
    bodyLimit: 35 * 1024 * 1024
  });
  await app.register(cookie);
  app.decorateRequest("auth", null);
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    try {
      done(null, rawBody.trim().length > 0 ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error);
    }
  });
  app.addHook("onRequest", async (request, reply) => {
    const operationId = getOperationIdFromHeaders(request.headers);
    reply.header("x-request-id", request.id);
    if (operationId) {
      reply.header("x-operation-id", operationId);
    }
    request.log.info(
      {
        requestId: request.id,
        operationId,
        method: request.method,
        url: request.url
      },
      "request.started"
    );
  });
  app.addHook("onResponse", async (request, reply) => {
    const operationId = getOperationIdFromHeaders(request.headers);
    request.log.info(
      {
        requestId: request.id,
        operationId,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime
      },
      "request.completed"
    );
  });
  app.log.info(
    {
      event: "startup.config",
      port: env.PORT,
      corsOrigin: env.CORS_ORIGIN,
      durableStores: "postgres",
      runtimeServices: "redis",
      postgresAutoMigrate: AUTO_RUN_POSTGRES_MIGRATIONS,
      sentryEnabled,
      taskWorkspaceRoot: env.TASK_WORKSPACE_ROOT,
      taskWorkspaceDockerSource: env.TASK_WORKSPACE_DOCKER_SOURCE
    },
    "Server configuration loaded"
  );

  const redisClients = createRedisClients(env.REDIS_URL);
  const eventBus = new EventBus(redisClients.pub, env.EVENT_CHANNEL);
  const postgresPool = createPostgresPool(env.DATABASE_URL);
  if (AUTO_RUN_POSTGRES_MIGRATIONS) {
    app.log.info({ event: "startup.migrations", mode: "auto" }, "Running Postgres migrations");
    await runPostgresMigrations(postgresPool);
    app.log.info({ event: "startup.migrations", mode: "auto" }, "Postgres migrations completed");
  } else {
    app.log.info({ event: "startup.migrations", mode: "manual" }, "Skipping auto-migrations");
  }

  const {
    taskStore,
    taskQueueStore,
    webhookDeliveryStore,
    repositoryStore,
    credentialStore,
    roleStore,
    userStore,
    personalAccessTokenStore,
    sessionStore,
    settingsStore
  } = createPostgresStores(
    postgresPool,
    redisClients,
    eventBus,
    env.AUTH_SESSION_TTL_DAYS
  );
  const auth = createAuthService({
    userStore,
    sessionStore,
    cookieName: env.AUTH_COOKIE_NAME,
    taskStore,
    personalAccessTokenStore
  });
  const spawner = new SpawnerService(taskStore, settingsStore, userStore, repositoryStore, undefined, personalAccessTokenStore);
  const scheduler = new SchedulerService(taskStore, taskQueueStore, settingsStore, spawner);
  const webhookDeliveryService = new WebhookDeliveryService(webhookDeliveryStore, repositoryStore);

  await roleStore.ensureDefaultAdminRole();
  await userStore.ensureDefaultAdminUser({
    name: env.DEFAULT_ADMIN_NAME,
    email: env.DEFAULT_ADMIN_EMAIL,
    password: env.DEFAULT_ADMIN_PASSWORD
  });

  registerAuthRoutes(app, { auth, userStore, sessionStore, personalAccessTokenStore });
  registerUserRoutes(app, { auth, userStore, roleStore, sessionStore });
  registerRoleRoutes(app, { auth, roleStore, userStore, sessionStore });
  registerTaskRoutes(app, {
    taskStore,
    taskQueueStore,
    repositoryStore,
    userStore,
    scheduler,
    spawner,
    settingsStore,
    auth
  });
  registerRepositoryRoutes(app, { repositoryStore, userStore, auth });
  registerGitHubPrWebhookRoutes(app, { repositoryStore, taskStore, taskQueueStore, scheduler, settingsStore, spawner, userStore });
  registerSlackWebhookRoutes(app, { repositoryStore, taskStore, scheduler, settingsStore, spawner });
  registerSettingsRoutes(app, { settingsStore, scheduler, auth });
  registerMcpRoutes(app, {
    auth,
    repositoryStore,
    settingsStore,
    taskStore,
    taskQueueStore,
    scheduler,
    spawner
  });

  app.get("/health", async () => ({ ok: true }));

  app.setErrorHandler((error, request, reply) => {
    const operationId = getOperationIdFromHeaders(request.headers);
    request.log.error(
      {
        err: error,
        requestId: request.id,
        operationId,
        method: request.method,
        url: request.url
      },
      "request.failed"
    );
    if (sentryEnabled) {
      Sentry.captureException(error, {
        tags: {
          route: request.routeOptions.url
        },
        extra: {
          requestId: request.id,
          operationId,
          method: request.method,
          url: request.url
        }
      });
    }
    void reply.send(error);
  });

  await app.ready();
  attachTaskInteractiveTerminalUpgrade(app.server, {
    auth,
    taskStore,
    settingsStore,
    spawner,
    userStore,
    repositoryStore
  });
  attachSettingsProviderTerminalUpgrade(app.server, { auth, settingsStore });

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true
    }
  });
  io.use(auth.authorizeSocket());

  io.on("connection", (socket) => {
    auth.onSocketConnection(socket);
    app.log.info({ socketId: socket.id }, "Socket client connected");
  });

  await redisClients.sub.subscribe(env.EVENT_CHANNEL);
  redisClients.sub.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      void webhookDeliveryService.handleRealtimeEvent(event);
      void auth.emitScopedRealtimeEvent(io, event);
    } catch (error) {
      app.log.error({ error }, "Failed to parse event message");
    }
  });

  webhookDeliveryService.start();
  await scheduler.bootstrap();

  let closeStarted = false;
  const close = async (): Promise<void> => {
    if (closeStarted) {
      return;
    }
    closeStarted = true;
    scheduler.stop();
    webhookDeliveryService.stop();
    io.close();
    await Promise.all([
      ...(postgresPool ? [postgresPool.end()] : []),
      redisClients.command.quit(),
      redisClients.pub.quit(),
      redisClients.sub.quit()
    ]);
    await app.close();
    if (sentryEnabled) {
      await Sentry.close(2_000);
    }
  };

  process.on("SIGINT", () => {
    app.log.warn({ signal: "SIGINT" }, "Shutdown signal received");
    void close();
  });
  process.on("SIGTERM", () => {
    app.log.warn({ signal: "SIGTERM" }, "Shutdown signal received");
    void close();
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal({ err: error }, "Unhandled exception");
    if (sentryEnabled) {
      Sentry.captureException(error);
    }
    void close().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    app.log.fatal({ reason }, "Unhandled promise rejection");
    if (sentryEnabled) {
      Sentry.captureException(reason);
    }
    void close().finally(() => process.exit(1));
  });

  const listenAddress = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(
    {
      event: "startup.ready",
      listenAddress,
      healthPath: "/health",
      proxyHealthPath: "/api/health"
    },
    "Server started"
  );
};

void bootstrap().catch((error) => {
  // Startup errors should stop the process so Docker restart policies can react.
  const errorForLog =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  console.error(
    JSON.stringify({
      level: "fatal",
      event: "startup.bootstrap_failed",
      error: errorForLog
    })
  );
  process.exit(1);
});
