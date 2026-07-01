import type { AnalyticsService } from "./analytics.service.js";
import type { FinanceService } from "./finance.service.js";
import type { OrdersService } from "./orders.service.js";

export class DashboardService {
  constructor(
    private readonly orders: OrdersService,
    private readonly analytics: AnalyticsService,
    private readonly finance: FinanceService,
  ) {}

  async get() {
    const [orders, sales, finance] = await Promise.all([
      this.orders.list({ page: 1 }),
      this.analytics.sales(),
      this.finance.summary(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      orders: {
        total: orders.total,
        latest: orders.orders.slice(0, 10),
      },
      sales,
      finance,
    };
  }
}
