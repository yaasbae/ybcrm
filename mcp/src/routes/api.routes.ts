import { Router } from "express";
import type { Container } from "../types/container.js";
import { asyncHandler } from "../utils/errors.js";

export function createApiRouter(container: Container) {
  const router = Router();

  router.get(
    "/orders",
    asyncHandler(async (req, res) => {
      res.json(await container.orders.list(req.query as any));
    }),
  );

  router.get(
    "/orders/:id",
    asyncHandler(async (req, res) => {
      res.json(await container.orders.get(String(req.params.id)));
    }),
  );

  router.patch(
    "/orders/:id",
    asyncHandler(async (req, res) => {
      res.json(await container.orders.updateStatus(String(req.params.id), req.body.status));
    }),
  );

  router.get(
    "/clients/search",
    asyncHandler(async (req, res) => {
      res.json(await container.clients.search(String(req.query.query || "")));
    }),
  );

  router.get(
    "/analytics/sales",
    asyncHandler(async (_req, res) => {
      res.json(await container.analytics.sales());
    }),
  );

  router.get(
    "/instagram/stats",
    asyncHandler(async (req, res) => {
      res.json(await container.instagram.stats(req.query as any));
    }),
  );

  router.get(
    "/content/analytics",
    asyncHandler(async (_req, res) => {
      res.json(await container.contentAnalytics.analytics());
    }),
  );

  router.get(
    "/finance/summary",
    asyncHandler(async (_req, res) => {
      res.json(await container.finance.summary());
    }),
  );

  router.post(
    "/tasks",
    asyncHandler(async (req, res) => {
      res.json(await container.tasks.create(req.body));
    }),
  );

  router.get(
    "/dashboard",
    asyncHandler(async (_req, res) => {
      res.json(await container.dashboard.get());
    }),
  );

  return router;
}
