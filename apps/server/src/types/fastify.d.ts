import "fastify";
import type { RequestAuthContext } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuthContext | null;
  }
}
