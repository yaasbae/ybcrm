import { Router } from "express";
import { aiContextFromRequest } from "../ai-tools/context.js";
import type { Container } from "../types/container.js";
import type { AuthRequest } from "../utils/auth.js";
import { asyncHandler } from "../utils/errors.js";

export function createApiRouter(container: Container) {
  const router = Router();

  router.get("/ai-tools", (_req, res) => {
    res.json({
      tools: container.aiTools.list().map(({ name, title, description, permission }) => ({
        name,
        title,
        description,
        permission,
        readOnly: true,
      })),
    });
  });

  router.post(
    "/ai-tools/:name",
    asyncHandler<AuthRequest>(async (req, res) => {
      const result = await container.aiTools.execute(
        String(req.params.name),
        req.body,
        aiContextFromRequest(req),
      );
      res.json(result);
    }),
  );

  return router;
}
