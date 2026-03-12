import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as SocketIOServer } from "socket.io";
import type { RealtimeEvent } from "@agentswarm/shared-types";
import { env } from "./config/env.js";
import { createRedisClients } from "./lib/redis.js";
import { EventBus } from "./lib/events.js";
import { TaskStore } from "./services/task-store.js";
import { RepositoryStore } from "./services/repository-store.js";
import { CredentialStore } from "./services/credential-store.js";
import { SettingsStore } from "./services/settings-store.js";
import { SpawnerService } from "./services/spawner.js";
import { SchedulerService } from "./services/scheduler.js";
import { GitHubImportService } from "./services/github-import-service.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRepositoryRoutes } from "./routes/repositories.js";
import { registerImportRoutes } from "./routes/imports.js";

const bootstrap = async (): Promise<void> => {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  const redisClients = createRedisClients(env.REDIS_URL);
  const eventBus = new EventBus(redisClients.pub, env.EVENT_CHANNEL);

  const taskStore = new TaskStore(redisClients.command, eventBus);
  const repositoryStore = new RepositoryStore(redisClients.command, eventBus);
  const credentialStore = new CredentialStore(redisClients.command);
  const settingsStore = new SettingsStore(redisClients.command, eventBus, credentialStore);
  const spawner = new SpawnerService(taskStore, settingsStore, repositoryStore);
  const scheduler = new SchedulerService(taskStore, settingsStore, spawner);
  const githubImportService = new GitHubImportService(settingsStore);

  registerTaskRoutes(app, { taskStore, repositoryStore, scheduler });
  registerRepositoryRoutes(app, { repositoryStore });
  registerSettingsRoutes(app, { settingsStore, scheduler });
  registerImportRoutes(app, { githubImportService, repositoryStore, taskStore, scheduler });

  app.get("/health", async () => ({ ok: true }));

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: env.CORS_ORIGIN
    }
  });

  io.on("connection", (socket) => {
    app.log.info({ socketId: socket.id }, "Socket client connected");
  });

  await redisClients.sub.subscribe(env.EVENT_CHANNEL);
  redisClients.sub.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      io.emit(event.type, event.payload);
    } catch (error) {
      app.log.error({ error }, "Failed to parse event message");
    }
  });

  await scheduler.bootstrap();

  const close = async (): Promise<void> => {
    scheduler.stop();
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
