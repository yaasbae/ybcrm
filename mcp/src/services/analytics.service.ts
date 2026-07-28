import type { Order, SalesAnalytics } from "../types/domain.js";
import { z } from "zod";
import type { OrdersService } from "./orders.service.js";

export const SalesAnalyticsSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseOrderDate(order: Order): Date | null {
  if (!order.date) return null;
  const date = new Date(order.date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sumPaid(orders: Order[]) {
  return orders.reduce((sum, order) => sum + (order.paidAmount || 0), 0);
}

export function calculateSalesAnalytics(orders: Order[], now = new Date()): SalesAnalytics {
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const withDates = orders.map((order) => ({ order, date: parseOrderDate(order) })).filter((row) => row.date);
  const today = withDates.filter((row) => row.date! >= todayStart).map((row) => row.order);
  const yesterday = withDates.filter((row) => row.date! >= yesterdayStart && row.date! < todayStart).map((row) => row.order);
  const week = withDates.filter((row) => row.date! >= weekStart).map((row) => row.order);
  const month = withDates.filter((row) => row.date! >= monthStart).map((row) => row.order);
  const sales = month.filter((order) => order.paidAmount > 0 || /оплачен/i.test(String(order.status || "")));
  const monthRevenue = sumPaid(month);

  return {
    today: sumPaid(today),
    yesterday: sumPaid(yesterday),
    week: sumPaid(week),
    month: monthRevenue,
    averageCheck: sales.length ? monthRevenue / sales.length : 0,
    ordersCount: month.length,
    conversion: month.length ? Math.round((sales.length / month.length) * 1000) / 10 : 0,
  };
}

export class AnalyticsService {
  constructor(private readonly orders: OrdersService) {}

  async sales(input: z.infer<typeof SalesAnalyticsSchema> = {}) {
    const parsed = SalesAnalyticsSchema.parse(input);
    const dateFrom = parsed.dateFrom || parsed.date_from;
    const dateTo = parsed.dateTo || parsed.date_to;
    let orders = await this.orders.listAll();
    if (dateFrom) orders = orders.filter((order) => Boolean(order.date && order.date >= dateFrom));
    if (dateTo) orders = orders.filter((order) => Boolean(order.date && order.date <= dateTo));

    if (!dateFrom && !dateTo) return calculateSalesAnalytics(orders);

    const paidOrders = orders.filter((order) => order.paidAmount > 0 || /оплачен|готов|доставлен/i.test(String(order.status || "")));
    const revenue = sumPaid(paidOrders);
    const grossRevenue = orders.reduce((sum, order) => sum + order.amountTotal + order.deliveryCost, 0);
    return {
      requestedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      appliedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      revenue,
      grossRevenue,
      ordersCount: orders.length,
      paidOrdersCount: paidOrders.length,
      averageCheck: paidOrders.length ? revenue / paidOrders.length : 0,
      conversion: orders.length ? Math.round((paidOrders.length / orders.length) * 1000) / 10 : 0,
    };
  }
}
