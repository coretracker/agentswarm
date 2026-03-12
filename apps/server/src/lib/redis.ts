import Redis from "ioredis";

export interface RedisClients {
  command: Redis;
  pub: Redis;
  sub: Redis;
}

export const createRedisClients = (redisUrl: string): RedisClients => {
  const command = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });

  return { command, pub, sub };
};
