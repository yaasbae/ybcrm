import { FirestoreAiAuditSink } from "../ai-tools/audit.js";
import { AiToolLayer } from "../ai-tools/tool-layer.js";
import { AgentReadService } from "../services/agent-read.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ClientsService } from "../services/clients.service.js";
import { ContentAnalyticsService } from "../services/content-analytics.service.js";
import { DashboardService } from "../services/dashboard.service.js";
import { FinanceService } from "../services/finance.service.js";
import { FirebaseService } from "../services/firebase.service.js";
import { InstagramService } from "../services/instagram.service.js";
import { OrdersService } from "../services/orders.service.js";
import { TasksService } from "../services/tasks.service.js";
import type { Container } from "../types/container.js";
import { loadConfig } from "../utils/config.js";
import { createHttpClient } from "../utils/http.js";
import { createLogger } from "../utils/logger.js";

export function createContainer(): Container {
  const config = loadConfig();
  const logger = createLogger();
  const http = createHttpClient();
  const firebase = new FirebaseService(config, logger);
  const orders = new OrdersService(firebase);
  const clients = new ClientsService(firebase, orders);
  const analytics = new AnalyticsService(orders);
  const instagram = new InstagramService(config, http, firebase);
  const contentAnalytics = new ContentAnalyticsService(instagram, orders);
  const finance = new FinanceService(firebase, orders);
  const tasks = new TasksService(firebase);
  const dashboard = new DashboardService(orders, analytics, finance);
  const agentRead = new AgentReadService(firebase, orders);
  const aiAudit = new FirestoreAiAuditSink(firebase, logger);
  const aiTools = new AiToolLayer({ clients, orders, analytics, agentRead, finance }, aiAudit);

  return {
    config,
    logger,
    firebase,
    orders,
    clients,
    analytics,
    instagram,
    contentAnalytics,
    finance,
    tasks,
    dashboard,
    agentRead,
    aiAudit,
    aiTools,
  };
}
