import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Server as SocketIOServer } from "socket.io";
import type { RealtimeEvent } from "@agentswarm/shared-types";
import { env } from "./config/env.js";
import { createAuthService } from "./lib/auth.js";
import { createRedisClients } from "./lib/redis.js";
import { EventBus } from "./lib/events.js";
import { TaskStore } from "./services/task-store.js";
import { SnippetStore } from "./services/snippet-store.js";
import { RepositoryStore } from "./services/repository-store.js";
import { CredentialStore } from "./services/credential-store.js";
import { RoleStore } from "./services/role-store.js";
import { SessionStore } from "./services/session-store.js";
import { SettingsStore } from "./services/settings-store.js";
import { UserStore } from "./services/user-store.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { SpawnerService } from "./services/spawner.js";
import { SchedulerService } from "./services/scheduler.js";
import { GitHubImportService } from "./services/github-import-service.js";
import { WebhookDeliveryService } from "./services/webhook-delivery-service.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRepositoryRoutes } from "./routes/repositories.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerSnippetRoutes } from "./routes/snippets.js";
import { attachTaskInteractiveTerminalUpgrade } from "./lib/task-interactive-terminal.js";

const bootstrap = async (): Promise<void> => {
  const app = Fastify({ logger: true });
  await app.register(cookie);
  app.decorateRequest("auth", null);
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  const redisClients = createRedisClients(env.REDIS_URL);
  const eventBus = new EventBus(redisClients.pub, env.EVENT_CHANNEL);

  const taskStore = new TaskStore(redisClients.command, eventBus);
  const snippetStore = new SnippetStore(redisClients.command, eventBus);
  const repositoryStore = new RepositoryStore(redisClients.command, eventBus);
  const credentialStore = new CredentialStore(redisClients.command);
  const roleStore = new RoleStore(redisClients.command);
  const userStore = new UserStore(redisClients.command, roleStore);
  const sessionStore = new SessionStore(redisClients.command, env.AUTH_SESSION_TTL_DAYS);
  const settingsStore = new SettingsStore(redisClients.command, eventBus, credentialStore);
  const auth = createAuthService({
    userStore,
    sessionStore,
    cookieName: env.AUTH_COOKIE_NAME,
    taskStore
  });
  const spawner = new SpawnerService(taskStore, settingsStore, userStore);
  const scheduler = new SchedulerService(taskStore, settingsStore, spawner);
  const githubImportService = new GitHubImportService(settingsStore);
  const webhookDeliveryService = new WebhookDeliveryService(redisClients.command, repositoryStore);

  await roleStore.ensureDefaultAdminRole();
  await userStore.ensureDefaultAdminUser({
    name: env.DEFAULT_ADMIN_NAME,
    email: env.DEFAULT_ADMIN_EMAIL,
    password: env.DEFAULT_ADMIN_PASSWORD
  });

  registerAuthRoutes(app, { auth, userStore, sessionStore });
  registerUserRoutes(app, { auth, userStore, roleStore, sessionStore });
  registerRoleRoutes(app, { auth, roleStore, userStore, sessionStore });
  registerTaskRoutes(app, { taskStore, repositoryStore, scheduler, spawner, settingsStore, auth });
  registerSnippetRoutes(app, { snippetStore, auth });
  registerRepositoryRoutes(app, { repositoryStore, auth });
  registerSettingsRoutes(app, { settingsStore, scheduler, auth });
  registerImportRoutes(app, { githubImportService, repositoryStore, taskStore, scheduler, spawner, auth });

  app.get("/health", async () => ({ ok: true }));

  await app.ready();
  attachTaskInteractiveTerminalUpgrade(app.server, {
    auth,
    taskStore,
    settingsStore,
    spawner
  });

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

  const close = async (): Promise<void> => {
    scheduler.stop();
    webhookDeliveryService.stop();
    io.close();
    await Promise.all([
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
