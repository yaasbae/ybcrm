import type { InstagramService } from "./instagram.service.js";
import type { OrdersService } from "./orders.service.js";

export class ContentAnalyticsService {
  constructor(
    private readonly instagram: InstagramService,
    private readonly orders: OrdersService,
  ) {}

  async analytics() {
    const [instagram, orders] = await Promise.all([this.instagram.stats().catch(() => null), this.orders.listAll()]);
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

    return { reels };
  }
}
