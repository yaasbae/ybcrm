import type { FinanceSummary } from "../types/domain.js";
import type { FirebaseService } from "./firebase.service.js";
import type { OrdersService } from "./orders.service.js";

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Number(value.replace(/\s/g, "").replace(",", ".")) || 0;
  return 0;
}

export class FinanceService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly orders: OrdersService,
  ) {}

  async summary(): Promise<FinanceSummary> {
    const [orders, expensesSnap] = await Promise.all([
      this.orders.listAll(),
      this.firebase.db().collection("expenses").limit(5000).get().catch(() => null),
    ]);

    const revenue = orders.reduce((sum, order) => sum + order.paidAmount, 0);
    const expenses = expensesSnap?.docs.reduce((sum, doc) => sum + asNumber(doc.data().amount), 0) || 0;
    const salaries =
      expensesSnap?.docs
        .filter((doc) => /фот|зарплат|оклад/i.test(String(doc.data().category || doc.data().name || "")))
        .reduce((sum, doc) => sum + asNumber(doc.data().amount), 0) || 0;
    const rent =
      expensesSnap?.docs
        .filter((doc) => /аренд/i.test(String(doc.data().category || doc.data().name || "")))
        .reduce((sum, doc) => sum + asNumber(doc.data().amount), 0) || 0;
    const profit = revenue - expenses;

    return {
      revenue,
      profit,
      expenses,
      salaries,
      rent,
      balance: profit,
    };
  }
}
