import { describe, expect, it } from "vitest";
import { calculateSalesAnalytics } from "../src/services/analytics.service.js";
import type { Order } from "../src/types/domain.js";

function order(date: string, paidAmount: number, amountTotal = paidAmount): Order {
  return {
    id: date,
    orderId: date,
    date,
    amountTotal,
    paidAmount,
    dueAmount: Math.max(0, amountTotal - paidAmount),
    deliveryCost: 0,
    items: [],
    status: paidAmount > 0 ? "Оплачен" : "Новый",
  };
}

describe("calculateSalesAnalytics", () => {
  it("counts today, yesterday, week, month, average check and conversion", () => {
    const result = calculateSalesAnalytics(
      [
        order("2026-06-29", 10000),
        order("2026-06-28", 5000),
        order("2026-06-20", 0, 20000),
        order("2026-05-10", 9000),
      ],
      new Date("2026-06-29T12:00:00+03:00"),
    );

    expect(result.today).toBe(10000);
    expect(result.yesterday).toBe(5000);
    expect(result.month).toBe(15000);
    expect(result.ordersCount).toBe(3);
    expect(result.averageCheck).toBe(7500);
    expect(result.conversion).toBe(66.7);
  });
});
