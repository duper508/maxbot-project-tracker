import type { ContentfulStatusCode } from "hono/utils/http-status";

export class KanbanError extends Error {
  constructor(
    message: string,
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
  ) {
    super(message);
    this.name = "KanbanError";
  }
}

export function notFound(resource: string): KanbanError {
  return new KanbanError(`${resource} not found`, 404, "NOT_FOUND");
}

export function forbidden(message = "Forbidden"): KanbanError {
  return new KanbanError(message, 403, "FORBIDDEN");
}

export function badRequest(message: string): KanbanError {
  return new KanbanError(message, 400, "BAD_REQUEST");
}

export function unauthorized(message = "Unauthorized"): KanbanError {
  return new KanbanError(message, 401, "UNAUTHORIZED");
}
