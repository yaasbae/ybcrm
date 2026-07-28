import { describe, expect, it } from "vitest";
import { normalizeOrder, normalizeOrderNumber, OrdersService } from "../src/services/orders.service.js";

describe("OrdersService", () => {
  it("loads historical orders without requiring createdAt and sorts by order date", async () => {
    const documents = [
      {
        id: "#6841С",
        data: () => ({
          orderId: "#6841С",
          date: "26.07.2026",
          clientName: "Клиент 1",
          clientInsta: "@client",
          item: "Бомбер",
          revenue: 19_900,
          deliveryPrice: 650,
          paidAmount: 20_550,
        }),
      },
      {
        id: "6776C",
        data: () => ({
          orderId: "6776C",
          date: "25.07.2026",
          item: "Костюм",
          revenue: 17_900,
        }),
      },
    ];
    const firebase = {
      db: () => ({
        collection: () => ({
          limit: () => ({ get: async () => ({ docs: documents }) }),
        }),
      }),
    } as any;

    const result = await new OrdersService(firebase).list({ page: 1 });

    expect(result.total).toBe(2);
    expect(result.orders[0].orderId).toBe("#6841С");
    expect(result.orders[0].instagram).toBe("@client");
    expect(result.orders[0].amountTotal).toBe(19_900);
  });

  it("normalizes historical Cyrillic and Latin order suffixes", () => {
    expect(normalizeOrderNumber("#6841С")).toBe("6841C");
    expect(normalizeOrderNumber("6841C")).toBe("6841C");
    expect(normalizeOrder("doc", { orderId: "1", deliveryMethod: "СДЭК" }).delivery).toBe("СДЭК");
  });
});
