import { z } from "zod";
import type { FirebaseService } from "./firebase.service.js";
import type { OrdersService } from "./orders.service.js";

const PeriodSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const SearchSchema = z.object({
  query: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 40) : parsed.toISOString();
}

function inPeriod(value: string | null, dateFrom?: string, dateTo?: string): boolean {
  if (!value) return !dateFrom && !dateTo;
  const day = value.slice(0, 10);
  return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
}

export class AgentReadService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly orders: OrdersService,
  ) {}

  async payments(input: z.input<typeof PeriodSchema>) {
    const params = PeriodSchema.parse(input);
    const rows = (await this.orders.listAll())
      .filter((order) => inPeriod(order.date || null, params.dateFrom, params.dateTo))
      .slice(0, params.limit)
      .map((order) => ({
        orderId: order.orderId,
        date: order.date || null,
        paymentType: order.paymentType || null,
        initialPaymentStatus: order.initialPaymentStatus || null,
        finalPaymentStatus: order.finalPaymentStatus || null,
        orderAmount: order.amountTotal + order.deliveryCost,
        paidAmount: order.paidAmount,
        dueAmount: order.dueAmount,
      }));
    return {
      source: "orders_new",
      warning: "Платежи пока хранятся в заказах, отдельного платежного реестра нет.",
      total: rows.length,
      payments: rows,
    };
  }

  async inventory(input: z.input<typeof SearchSchema>) {
    const params = SearchSchema.parse(input);
    const needle = params.query.trim().toLocaleLowerCase("ru-RU");
    const snap = await this.firebase.db().collection("products").limit(1000).get();
    const products = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: String(data.name || ""),
          color: String(data.color || ""),
          sizeGrid: String(data.sizeGrid || ""),
          collectionName: String(data.collectionName || ""),
          costPrice: asNumber(data.costPrice),
          sellingPrice: asNumber(data.sellingPrice),
          stockQuantity: data.stockQuantity == null ? null : asNumber(data.stockQuantity),
        };
      })
      .filter((product) => !needle || `${product.name} ${product.color} ${product.collectionName}`.toLocaleLowerCase("ru-RU").includes(needle))
      .slice(0, params.limit);
    return {
      source: "products",
      inventoryTracking: products.some((product) => product.stockQuantity !== null),
      warning: "Коллекция products сейчас в основном является каталогом; системный количественный учет остатков не подтвержден.",
      total: products.length,
      products,
    };
  }

  async production(input: z.input<typeof PeriodSchema>) {
    const params = PeriodSchema.parse(input);
    const snap = await this.firebase.db().collection("production_entries").limit(2000).get();
    const entries = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          productName: String(data.productName || ""),
          date: String(data.date || asDate(data.createdAt)?.slice(0, 10) || ""),
          quantity: asNumber(data.quantity),
          cuttingCost: asNumber(data.cuttingCost),
          sewingCost: asNumber(data.sewingCost ?? data.cost),
        };
      })
      .filter((entry) => inPeriod(entry.date, params.dateFrom, params.dateTo))
      .sort((a, b) => b.date.localeCompare(a.date));
    const selected = entries.slice(0, params.limit);
    return {
      source: "production_entries",
      total: entries.length,
      totalQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      entries: selected,
    };
  }

  async tasks(input: z.input<typeof SearchSchema>) {
    const params = SearchSchema.parse(input);
    const needle = params.query.trim().toLocaleLowerCase("ru-RU");
    const snap = await this.firebase.db().collection("tasks").limit(500).get();
    const tasks = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: String(data.title || ""),
          description: String(data.description || ""),
          manager: String(data.manager || ""),
          status: String(data.status || ""),
          dueDate: String(data.dueDate || ""),
          createdAt: asDate(data.createdAt),
        };
      })
      .filter((task) => !needle || `${task.title} ${task.description} ${task.manager} ${task.status}`.toLocaleLowerCase("ru-RU").includes(needle))
      .slice(0, params.limit);
    return { source: "tasks", total: tasks.length, tasks };
  }

  async supplier(id: string) {
    return {
      id,
      found: false,
      source: null,
      warning: "В текущей CRM не найден единый справочник поставщиков. Инструмент намеренно не угадывает данные из заметок.",
    };
  }

  async communications(input: z.input<typeof SearchSchema>) {
    const params = SearchSchema.parse(input);
    const needle = params.query.trim().toLocaleLowerCase("ru-RU");
    const sources = ["bot_messages", "instagram_messages", "messages"] as const;
    const snapshots = await Promise.all(
      sources.map(async (source) => ({
        source,
        snap: await this.firebase.db().collection(source).limit(300).get().catch(() => null),
      })),
    );
    const communications = snapshots.flatMap(({ source, snap }) =>
      (snap?.docs || []).map((doc) => {
        const data = doc.data();
        const text = String(data.text || data.message || data.body || data.caption || "");
        return {
          id: doc.id,
          channel: source === "bot_messages" ? "telegram" : source === "instagram_messages" ? "instagram" : "other",
          direction: String(data.direction || data.type || "unknown"),
          text: text.slice(0, 1000),
          conversationId: String(data.conversationId || data.chatId || data.userId || ""),
          createdAt: asDate(data.createdAt || data.receivedAt || data.timestamp),
        };
      }),
    )
      .filter((item) => !needle || `${item.text} ${item.conversationId}`.toLocaleLowerCase("ru-RU").includes(needle))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, params.limit);
    return {
      sources: [...sources, "site_chat_conversations/{id}/messages (не включено: нужен безопасный индекс)"],
      total: communications.length,
      communications,
    };
  }
}
