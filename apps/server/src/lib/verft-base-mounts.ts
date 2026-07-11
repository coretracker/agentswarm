import { env } from "../config/env.js";

export const VERFT_BASE_CONTAINER_ROOT = "/verft-base";

export function buildVerftBaseVolumeMountArgs(): string[] {
  return ["-v", `${env.VERFT_BASE_VOLUME}:${VERFT_BASE_CONTAINER_ROOT}:rw`];
}

export function buildVerftBaseEnvArgs(): string[] {
  return ["-e", `VERFT_BASE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`, "-e", `VERFT_AI_STATE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`];
}
