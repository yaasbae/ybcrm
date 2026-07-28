import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { Order, OrderItem } from "../types/domain.js";
import { badRequest, notFound } from "../utils/errors.js";
import type { FirebaseService } from "./firebase.service.js";

export const OrdersListSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.string().optional(),
  manager: z.string().optional(),
  blogger: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const OrdersUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});

export const OrdersCreateSchema = z.object({
  orderId: z.string().optional(),
  date: z.string().optional(),
  clientName: z.string().optional(),
  phone: z.string().optional(),
  clientPhone: z.string().optional(),
  instagram: z.string().optional(),
  city: z.string().optional(),
  manager: z.string().optional(),
  blogger: z.string().optional(),
  source: z.string().optional(),
  delivery: z.string().optional(),
  deliveryPrice: z.coerce.number().optional(),
  paymentType: z.string().optional(),
  paidAmount: z.coerce.number().optional(),
  revenue: z.coerce.number().optional(),
  items: z.array(z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      product: z.string().optional(),
      title: z.string().optional(),
      price: z.coerce.number().optional(),
      quantity: z.coerce.number().optional(),
      qty: z.coerce.number().optional(),
      color: z.string().optional(),
      size: z.string().optional(),
      height: z.string().optional(),
      growth: z.string().optional(),
      label: z.string().optional(),
    }),
  ])).optional(),
  status: z.string().optional(),
});

export type OrdersListInput = z.input<typeof OrdersListSchema>;
export type OrdersCreateInput = z.infer<typeof OrdersCreateSchema>;

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateString(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const raw = value.trim();
    const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : parsed.toISOString().slice(0, 10);
  }
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  return undefined;
}

export function normalizeOrderNumber(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .toUpperCase()
    .replaceAll("С", "C")
    .replaceAll("Е", "E")
    .replace(/\s+/g, "");
}

function orderTimestamp(order: Order): number {
  const raw = order.raw || {};
  const candidates = [
    raw.createdAt,
    raw.updatedAt,
    order.date,
  ];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof (value as any)?.toDate === "function") return (value as any).toDate().getTime();
    if (typeof (value as any)?.seconds === "number") return (value as any).seconds * 1000;
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
}

function normalizeItems(data: Record<string, any>): OrderItem[] {
  const rawItems = data.items || data.products || data.orderItems || [];
  if (Array.isArray(rawItems) && rawItems.length) {
    const prices = Array.isArray(data.itemPrices) ? data.itemPrices : [];
    const colors = Array.isArray(data.itemColors) ? data.itemColors : [];
    const sizes = Array.isArray(data.itemSizes) ? data.itemSizes : [];
    const heights = Array.isArray(data.itemHeights) ? data.itemHeights : [];
    return rawItems.map((item, index) => ({
      name: typeof item === "string" ? item : String(item.name || item.product || item.title || "Изделие"),
      price: typeof item === "string" ? toNumber(prices[index]) : toNumber(item.price ?? item.amount ?? item.cost ?? prices[index]),
      quantity: typeof item === "string" ? 1 : Math.max(1, toNumber(item.quantity ?? item.qty ?? 1)),
      color: typeof item === "string" ? colors[index] : item.color || colors[index],
      size: typeof item === "string" ? sizes[index] : item.size || sizes[index],
      height: typeof item === "string" ? heights[index] : item.height || item.growth || heights[index],
      label: typeof item === "string" ? undefined : item.label || item.tag,
    }));
  }

  const name = data.productName || data.itemName || data.product || data.name;
  if (!name) return [];
  return [
    {
      name: String(name),
      price: toNumber(data.price ?? data.amountTotal ?? data.total),
      quantity: Math.max(1, toNumber(data.quantity ?? 1)),
      color: data.color,
      size: data.size,
      height: data.height || data.growth,
      label: data.label || data.tag,
    },
  ];
}

export function normalizeOrder(id: string, data: Record<string, any>): Order {
  const items = normalizeItems(data);
  const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCost = toNumber(data.deliveryCost ?? data.deliveryPrice ?? data.shippingCost);
  const amountTotal = toNumber(data.amountTotal ?? data.revenue ?? data.totalAmount ?? data.total ?? itemsTotal);
  const paidAmount = toNumber(data.paidAmount ?? data.prepaidAmount ?? data.paymentAmount ?? data.paid);
  const dueAmount = toNumber(data.dueAmount ?? data.toPay ?? Math.max(0, amountTotal + deliveryCost - paidAmount));

  return {
    id,
    orderId: String(data.orderId || data.id || id),
    date: toDateString(data.date || data.createdAt || data.orderDate),
    status: data.status,
    clientName: data.clientName || data.customerName || data.name,
    phone: data.phone || data.clientPhone || data.customerPhone,
    instagram: data.instagram || data.clientInstagram || data.clientInsta || data.insta,
    manager: data.manager || data.managerName,
    blogger: data.blogger || data.bloggerName,
    source: data.source,
    delivery: data.delivery || data.deliveryType || data.deliveryMethod,
    paymentType: data.paymentType || data.invoiceType || data.payment || data.prepaymentType,
    amountTotal,
    paidAmount,
    dueAmount,
    deliveryCost,
    items,
    raw: data,
  };
}

export class OrdersService {
  private readonly collectionName = "orders_new";

  constructor(private readonly firebase: FirebaseService) {}

  async list(input: OrdersListInput) {
    const params = OrdersListSchema.parse(input);
    const dateFrom = params.dateFrom || params.date_from;
    const dateTo = params.dateTo || params.date_to;
    const pageSize = params.pageSize;
    // Imported orders predate the createdAt field. Firestore orderBy silently
    // excludes documents where that field is absent, which made MCP report an
    // empty CRM while the web application still displayed those orders.
    const snap = await this.firebase.db().collection(this.collectionName).limit(5000).get();
    let orders = snap.docs
      .map((doc) => normalizeOrder(doc.id, doc.data()))
      .sort((a, b) => orderTimestamp(b) - orderTimestamp(a));

    if (dateFrom) orders = orders.filter((order) => Boolean(order.date && order.date >= dateFrom));
    if (dateTo) orders = orders.filter((order) => Boolean(order.date && order.date <= dateTo));
    if (params.status) orders = orders.filter((order) => String(order.status || "").toLowerCase() === params.status!.toLowerCase());
    if (params.manager) orders = orders.filter((order) => String(order.manager || "").toLowerCase().includes(params.manager!.toLowerCase()));
    if (params.blogger) orders = orders.filter((order) => String(order.blogger || "").toLowerCase().includes(params.blogger!.toLowerCase()));

    const total = orders.length;
    const start = (params.page - 1) * pageSize;
    return {
      page: params.page,
      pageSize,
      total,
      requestedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      appliedPeriod: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      orders: orders.slice(start, start + pageSize),
    };
  }

  async listAll(limit = 5000): Promise<Order[]> {
    const snap = await this.firebase.db().collection(this.collectionName).limit(limit).get();
    return snap.docs
      .map((doc) => normalizeOrder(doc.id, doc.data()))
      .sort((a, b) => orderTimestamp(b) - orderTimestamp(a));
  }

  async get(id: string): Promise<Order> {
    if (!id) throw badRequest("Нужен ID заказа");
    const clean = normalizeOrderNumber(id);
    const variants = new Set([
      String(id).trim(),
      String(id).trim().replace(/^#+/, ""),
      `#${String(id).trim().replace(/^#+/, "")}`,
      clean,
      `#${clean}`,
      clean.replaceAll("C", "С").replaceAll("E", "Е"),
      `#${clean.replaceAll("C", "С").replaceAll("E", "Е")}`,
    ]);

    for (const variant of variants) {
      const byDoc = await this.firebase.db().collection(this.collectionName).doc(variant).get();
      if (byDoc.exists) return normalizeOrder(byDoc.id, byDoc.data() || {});
    }

    for (const variant of variants) {
      const byOrderId = await this.firebase.db().collection(this.collectionName).where("orderId", "==", variant).limit(1).get();
      if (!byOrderId.empty) {
        const doc = byOrderId.docs[0];
        return normalizeOrder(doc.id, doc.data());
      }
    }

    // Last-resort normalization handles historical Latin/Cyrillic lookalikes.
    const all = await this.listAll();
    const match = all.find((order) => normalizeOrderNumber(order.orderId || order.id) === clean);
    if (match) {
      return match;
    }

    throw notFound(`Заказ ${id} не найден`);
  }

  async updateStatus(id: string, status: string): Promise<Order> {
    const parsed = OrdersUpdateSchema.parse({ id, status });
    const order = await this.get(parsed.id);
    await this.firebase.db().collection(this.collectionName).doc(order.id).set(
      {
        status: parsed.status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return this.get(order.id);
  }

  async create(input: OrdersCreateInput): Promise<Order> {
    const parsed = OrdersCreateSchema.parse(input);
    const items = normalizeItems(parsed);
    const itemNames = items.map((item) => item.name);
    const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const revenue = toNumber(parsed.revenue ?? itemsTotal);
    const deliveryPrice = toNumber(parsed.deliveryPrice);
    const paymentType = parsed.paymentType || "Предоплата 50%";
    const orderId = String(parsed.orderId || `MCP-${Date.now().toString(36).toUpperCase()}`).replace(/^#+/, "");
    const total = revenue + deliveryPrice;
    const paidAmount = parsed.paidAmount !== undefined
      ? toNumber(parsed.paidAmount)
      : paymentType.toLowerCase().includes("полная")
        ? total
        : paymentType.toLowerCase().includes("пример")
          ? 2000
          : Math.round(total / 2);

    await this.firebase.db().collection(this.collectionName).doc(orderId).set(
      {
        orderId,
        id: orderId,
        date: toDateString(parsed.date) || new Date().toISOString().slice(0, 10),
        clientName: parsed.clientName || "",
        clientPhone: parsed.phone || parsed.clientPhone || "",
        clientInsta: parsed.instagram || "",
        clientCity: parsed.city || "",
        item: itemNames.join(", "),
        items: itemNames,
        itemPrices: items.map((item) => item.price),
        itemColors: items.map((item) => item.color || ""),
        itemSizes: items.map((item) => item.size || ""),
        itemHeights: items.map((item) => item.height || ""),
        revenue,
        deliveryPrice,
        paidAmount,
        paymentType,
        invoiceType: paymentType,
        source: parsed.source || "",
        deliveryMethod: parsed.delivery || "",
        manager: parsed.manager || "",
        blogger: parsed.blogger || "",
        status: parsed.status || "Новый",
        createdBy: "mcp",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return this.get(orderId);
  }
}
