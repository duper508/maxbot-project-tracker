import type { Context, Next } from "hono";
import { KanbanError } from "./errors.js";
import { isInstanceUnclaimed, isLegacyClaimLive } from "../services/auth.js";

const EXEMPT_PATHS = new Set(["/health"]);
const SETUP_PATH = "/api/v1/setup";
const CLAIM_PATHS = new Set(["/api/v1/auth/claim", "/api/v1/auth/claim/complete"]);

export async function setupGate(c: Context, next: Next) {
  const path = c.req.path;

  if (EXEMPT_PATHS.has(path)) {
    return next();
  }

  const unclaimed = await isInstanceUnclaimed();
  if (!unclaimed) {
    return next();
  }

  const claimLive = await isLegacyClaimLive();

  if (claimLive) {
    // /setup stays reachable so it can return 409 CLAIM_REQUIRED per §2.2.
    if (CLAIM_PATHS.has(path) || path === SETUP_PATH) {
      return next();
    }
    throw new KanbanError("Instance setup required", 409, "SETUP_REQUIRED");
  }

  if (path === SETUP_PATH) {
    return next();
  }

  throw new KanbanError("Instance setup required", 409, "SETUP_REQUIRED");
}
