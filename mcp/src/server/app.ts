import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Container } from "../types/container.js";
import { authMiddleware } from "../utils/auth.js";
import { errorHandler } from "../utils/errors.js";
import { createApiRouter } from "../routes/api.routes.js";
import { createOAuthRouter } from "../routes/oauth.routes.js";
import { openApiDocument } from "../routes/openapi.js";
import { createMcpServer } from "../tools/mcp.js";

export function createApp(container: Container) {
  const app = express();
  const auth = authMiddleware(container.config);

  // Cloud Run terminates HTTPS in front of Express and supplies the real
  // client address through X-Forwarded-For. express-rate-limit validates this
  // setting and otherwise emits an error on the first request of every
  // instance, which can interrupt MCP/OAuth clients during a cold start.
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "ybcrm-mcp", time: new Date().toISOString() });
  });

  app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use(createOAuthRouter(container.config));
  app.use("/api", auth, createApiRouter(container));

  app.get("/mcp", auth, (_req, res) => {
    res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "MCP endpoint expects POST requests.",
    });
  });

  app.post("/mcp", auth, async (req, res, next) => {
    try {
      const server = createMcpServer(container);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}
