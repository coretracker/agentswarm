import type { FastifyReply } from "fastify";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const isHttpError = (error: unknown): error is HttpError => error instanceof HttpError;

export const sendHttpError = (reply: FastifyReply, error: unknown): FastifyReply | null => {
  if (!isHttpError(error)) {
    return null;
  }

  return reply.status(error.statusCode).send({ message: error.message });
};
