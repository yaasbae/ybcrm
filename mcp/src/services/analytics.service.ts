import type { Order, SalesAnalytics } from "../types/domain.js";
import type { OrdersService } from "./orders.service.js";

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

  async sales(): Promise<SalesAnalytics> {
    const orders = await this.orders.listAll();
    return calculateSalesAnalytics(orders);
  }
}
