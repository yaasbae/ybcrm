import type { AnalyticsService } from "../services/analytics.service.js";
import type { ClientsService } from "../services/clients.service.js";
import type { ContentAnalyticsService } from "../services/content-analytics.service.js";
import type { DashboardService } from "../services/dashboard.service.js";
import type { FinanceService } from "../services/finance.service.js";
import type { FirebaseService } from "../services/firebase.service.js";
import type { InstagramService } from "../services/instagram.service.js";
import type { OrdersService } from "../services/orders.service.js";
import type { TasksService } from "../services/tasks.service.js";
import type { Config } from "../utils/config.js";
import type { Logger } from "../utils/logger.js";

export interface Container {
  config: Config;
  logger: Logger;
  firebase: FirebaseService;
  orders: OrdersService;
  clients: ClientsService;
  analytics: AnalyticsService;
  instagram: InstagramService;
  contentAnalytics: ContentAnalyticsService;
  finance: FinanceService;
  tasks: TasksService;
  dashboard: DashboardService;
}
