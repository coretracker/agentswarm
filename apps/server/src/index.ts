import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Server as SocketIOServer } from "socket.io";
import type { RealtimeEvent } from "@agentswarm/shared-types";
import { env } from "./config/env.js";
import { createAuthService } from "./lib/auth.js";
import { createPostgresPool, runPostgresMigrations } from "./lib/postgres.js";
import { createRedisClients } from "./lib/redis.js";
import { EventBus } from "./lib/events.js";
import { usesPostgresBackends } from "./services/app-stores.js";
import { createAppStores } from "./services/create-app-stores.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { SpawnerService } from "./services/spawner.js";
import { SchedulerService } from "./services/scheduler.js";
import { GitHubImportService } from "./services/github-import-service.js";
import { WebhookDeliveryService } from "./services/webhook-delivery-service.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSlackRoutes } from "./routes/slack.js";
import { registerRepositoryRoutes } from "./routes/repositories.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerSnippetRoutes } from "./routes/snippets.js";
import { attachTaskInteractiveTerminalUpgrade } from "./lib/task-interactive-terminal.js";
import { SlackSocketModeService } from "./services/slack-socket-mode-service.js";

const bootstrap = async (): Promise<void> => {
  const app = Fastify({ logger: true, bodyLimit: 35 * 1024 * 1024 });
  await app.register(cookie);
  app.decorateRequest("auth", null);
  app.addContentTypeParser(/^application\/x-www-form-urlencoded(?:;.*)?$/i, { parseAs: "buffer" }, (request, payload, done) => {
    try {
      const rawBody = payload.toString("utf8");
      request.rawBody = rawBody;
      const parsed: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(rawBody).entries()) {
        parsed[key] = value;
      }
      done(null, parsed);
    } catch (error) {
      done(error as Error);
    }
  });
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  const redisClients = createRedisClients(env.REDIS_URL);
  const eventBus = new EventBus(redisClients.pub, env.EVENT_CHANNEL);
  const postgresPool = usesPostgresBackends(env.STORE_BACKENDS) ? createPostgresPool(env.DATABASE_URL) : null;
  if (postgresPool && env.POSTGRES_AUTO_MIGRATE) {
    await runPostgresMigrations(postgresPool);
  }

  const {
    taskStore,
    taskQueueStore,
    webhookDeliveryStore,
    snippetStore,
    repositoryStore,
    credentialStore,
    roleStore,
    userStore,
    sessionStore,
    settingsStore
  } = createAppStores({
    pool: postgresPool,
    redisClients,
    eventBus,
    sessionTtlDays: env.AUTH_SESSION_TTL_DAYS,
    backends: env.STORE_BACKENDS
  });
  const auth = createAuthService({
    userStore,
    sessionStore,
    cookieName: env.AUTH_COOKIE_NAME,
    taskStore,
    credentialStore
  });
  const spawner = new SpawnerService(taskStore, settingsStore, userStore, repositoryStore);
  const scheduler = new SchedulerService(taskStore, taskQueueStore, settingsStore, spawner);
  const githubImportService = new GitHubImportService(settingsStore);
  const webhookDeliveryService = new WebhookDeliveryService(webhookDeliveryStore, repositoryStore);
  const slackSocketModeService = new SlackSocketModeService(app, settingsStore);

  await roleStore.ensureDefaultAdminRole();
  await userStore.ensureDefaultAdminUser({
    name: env.DEFAULT_ADMIN_NAME,
    email: env.DEFAULT_ADMIN_EMAIL,
    password: env.DEFAULT_ADMIN_PASSWORD
  });

  registerAuthRoutes(app, { auth, userStore, sessionStore, credentialStore });
  registerUserRoutes(app, { auth, userStore, roleStore, sessionStore });
  registerRoleRoutes(app, { auth, roleStore, userStore, sessionStore });
  registerTaskRoutes(app, { taskStore, taskQueueStore, repositoryStore, userStore, scheduler, spawner, settingsStore, auth });
  registerSnippetRoutes(app, { snippetStore, auth });
  registerRepositoryRoutes(app, { repositoryStore, userStore, auth });
  registerSettingsRoutes(app, { settingsStore, scheduler, auth });
  registerSlackRoutes(app, { settingsStore, userStore, repositoryStore, taskStore, scheduler, spawner });
  registerImportRoutes(app, { githubImportService, repositoryStore, settingsStore, taskStore, userStore, scheduler, spawner, auth });

  app.get("/health", async () => ({ ok: true }));

  await app.ready();
  attachTaskInteractiveTerminalUpgrade(app.server, {
    auth,
    taskStore,
    settingsStore,
    spawner,
    userStore,
    repositoryStore
  });

  await slackSocketModeService.sync();

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
      if (event.type === "settings:updated") {
        void slackSocketModeService.sync();
      }
    } catch (error) {
      app.log.error({ error }, "Failed to parse event message");
    }
  });

  webhookDeliveryService.start();
  await scheduler.bootstrap();

  const close = async (): Promise<void> => {
    scheduler.stop();
    webhookDeliveryService.stop();
    await slackSocketModeService.stop();
    io.close();
    await Promise.all([
      ...(postgresPool ? [postgresPool.end()] : []),
      redisClients.command.quit(),
      redisClients.pub.quit(),
      redisClients.sub.quit()
    ]);
    await app.close();
  };

  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

void bootstrap().catch((error) => {
  // Startup errors should stop the process so Docker restart policies can react.
  console.error(error);
  process.exit(1);
});
