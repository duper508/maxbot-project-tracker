import type { Context, Next } from "hono";
import { KanbanError } from "./errors.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getOriginHost(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function csrfMiddleware(c: Context, next: Next) {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    return next();
  }

  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    throw new KanbanError("Cross-site request rejected", 403, "CSRF_REJECTED");
  }

  const origin = c.req.header("origin");
  if (origin === "null") {
    throw new KanbanError("Null origin request rejected", 403, "CSRF_REJECTED");
  }

  // Same-origin requests and trustworthy same-site requests are allowed without
  // a further Origin check. If Origin is present, require it to match the Host.
  if (origin) {
    const originHost = getOriginHost(origin);
    const host = c.req.header("host");
    if (originHost && host && originHost !== host) {
      throw new KanbanError("Origin does not match Host", 403, "CSRF_REJECTED");
    }
  }

  return next();
}
