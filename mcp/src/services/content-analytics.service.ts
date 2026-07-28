import type { InstagramService } from "./instagram.service.js";
import type { OrdersService } from "./orders.service.js";

export class ContentAnalyticsService {
  constructor(
    private readonly instagram: InstagramService,
    private readonly orders: OrdersService,
  ) {}

  async analytics(input: { dateFrom?: string; dateTo?: string; date_from?: string; date_to?: string } = {}) {
    const dateFrom = input.dateFrom || input.date_from;
    const dateTo = input.dateTo || input.date_to;
    const [instagram, allOrders] = await Promise.all([
      this.instagram.stats({ dateFrom, dateTo }).catch(() => null),
      this.orders.listAll(),
    ]);
    const orders = allOrders.filter((order) => {
      if (dateFrom && (!order.date || order.date < dateFrom)) return false;
      if (dateTo && (!order.date || order.date > dateTo)) return false;
      return true;
    });
    const media = instagram?.media || [];

    const reels = media.map((item: any) => {
      const caption = String(item.caption || "").toLowerCase();
      const linkedOrders = orders.filter((order) => {
        const source = `${order.source || ""} ${order.blogger || ""} ${order.raw?.reelId || ""}`.toLowerCase();
        return source && (source.includes(String(item.id)) || caption.includes(source));
      });
      const revenue = linkedOrders.reduce((sum, order) => sum + order.paidAmount, 0);
      return {
        reelId: item.id,
        caption: item.caption || "",
        permalink: item.permalink,
        orders: linkedOrders.length,
        revenue,
        romi: 0,
        conversion: linkedOrders.length,
      };
    });

    return {
      requestedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      appliedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      attribution: {
        method: "source/blogger/reelId",
        warning: "ROMI и конверсия доступны только для заказов, где заполнена связь с публикацией или источником.",
      },
      reels,
    };
  }
}
