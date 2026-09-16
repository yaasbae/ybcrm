import type { AuthRequest } from "../utils/auth.js";
import { resolvePermissions } from "./permissions.js";
import type { AiToolContext } from "./types.js";

export function aiContextFromRequest(req: AuthRequest): AiToolContext {
  return {
    agentId: String(req.user?.agent_id || req.user?.sub || "unknown-agent").slice(0, 120),
    userId: String(req.user?.email || req.user?.sub || "unknown-user").slice(0, 200),
    permissions: resolvePermissions(req.user?.scope, req.user?.permissions),
    reason: typeof req.headers["x-ai-reason"] === "string"
      ? req.headers["x-ai-reason"].slice(0, 500)
      : undefined,
  };
}
