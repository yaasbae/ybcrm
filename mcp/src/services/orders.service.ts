import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { Order, OrderItem } from "../types/domain.js";
import { badRequest, notFound } from "../utils/errors.js";
import type { FirebaseService } from "./firebase.service.js";

export const OrdersListSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  status: z.string().optional(),
  manager: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const OrdersUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});

export type OrdersListInput = z.infer<typeof OrdersListSchema>;

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
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return undefined;
}

function normalizeItems(data: Record<string, any>): OrderItem[] {
  const rawItems = data.items || data.products || data.orderItems || [];
  if (Array.isArray(rawItems) && rawItems.length) {
    return rawItems.map((item) => ({
      name: String(item.name || item.product || item.title || "Изделие"),
      price: toNumber(item.price ?? item.amount ?? item.cost),
      quantity: Math.max(1, toNumber(item.quantity ?? item.qty ?? 1)),
      color: item.color,
      size: item.size,
      height: item.height || item.growth,
      label: item.label || item.tag,
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
  const amountTotal = toNumber(data.amountTotal ?? data.totalAmount ?? data.total ?? itemsTotal);
  const paidAmount = toNumber(data.paidAmount ?? data.prepaidAmount ?? data.paymentAmount ?? data.paid);
  const dueAmount = toNumber(data.dueAmount ?? data.toPay ?? Math.max(0, amountTotal + deliveryCost - paidAmount));

  return {
    id,
    orderId: String(data.orderId || data.id || id),
    date: toDateString(data.date || data.createdAt || data.orderDate),
    status: data.status,
    clientName: data.clientName || data.customerName || data.name,
    phone: data.phone || data.clientPhone || data.customerPhone,
    instagram: data.instagram || data.clientInstagram,
    manager: data.manager || data.managerName,
    blogger: data.blogger || data.bloggerName,
    source: data.source,
    delivery: data.delivery || data.deliveryType,
    paymentType: data.paymentType || data.payment || data.prepaymentType,
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
    const pageSize = 50;
    const snap = await this.firebase.db().collection(this.collectionName).orderBy("createdAt", "desc").limit(2000).get();
    let orders = snap.docs.map((doc) => normalizeOrder(doc.id, doc.data()));

    if (params.date_from) orders = orders.filter((order) => !order.date || order.date >= params.date_from!);
    if (params.date_to) orders = orders.filter((order) => !order.date || order.date <= params.date_to!);
    if (params.status) orders = orders.filter((order) => String(order.status || "").toLowerCase() === params.status!.toLowerCase());
    if (params.manager) orders = orders.filter((order) => String(order.manager || "").toLowerCase().includes(params.manager!.toLowerCase()));

    const total = orders.length;
    const start = (params.page - 1) * pageSize;
    return {
      page: params.page,
      pageSize,
      total,
      orders: orders.slice(start, start + pageSize),
    };
  }

  async listAll(limit = 5000): Promise<Order[]> {
    const snap = await this.firebase.db().collection(this.collectionName).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((doc) => normalizeOrder(doc.id, doc.data()));
  }

  async get(id: string): Promise<Order> {
    if (!id) throw badRequest("Нужен ID заказа");
    const byDoc = await this.firebase.db().collection(this.collectionName).doc(id).get();
    if (byDoc.exists) return normalizeOrder(byDoc.id, byDoc.data() || {});

    const byOrderId = await this.firebase.db().collection(this.collectionName).where("orderId", "==", id).limit(1).get();
    if (!byOrderId.empty) {
      const doc = byOrderId.docs[0];
      return normalizeOrder(doc.id, doc.data());
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
}
