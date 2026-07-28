import { z } from "zod";
import type { Client } from "../types/domain.js";
import { badRequest } from "../utils/errors.js";
import type { FirebaseService } from "./firebase.service.js";
import type { OrdersService } from "./orders.service.js";

export const ClientsSearchSchema = z.object({
  query: z.string().min(2),
});

function normalizeClient(id: string, data: Record<string, any>): Client {
  return {
    id,
    name: data.name || data.clientName || data.fullName,
    phone: data.phone || data.clientPhone,
    instagram: data.instagram || data.insta,
    city: data.city,
    ordersCount: Number(data.ordersCount || data.orders || 0),
    totalAmount: Number(data.totalAmount || data.totalSpent || data.sum || 0),
    raw: data,
  };
}

export class ClientsService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly orders: OrdersService,
  ) {}

  async search(queryValue: string) {
    const { query } = ClientsSearchSchema.parse({ query: queryValue });
    const needle = query.toLowerCase().replace(/[^\dа-яa-z_@.]/gi, "");
    const contactsSnap = await this.firebase.db().collection("contacts").limit(10000).get();
    const clients = contactsSnap.docs
      .map((doc) => normalizeClient(doc.id, doc.data()))
      .filter((client) => {
        const haystack = [client.name, client.phone, client.instagram, client.city]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .replace(/[^\dа-яa-z_@.]/gi, "");
        return haystack.includes(needle);
      })
      .slice(0, 50);

    const orderMatches = query.startsWith("#") || /\d/.test(query) ? await this.findClientsByOrder(query) : [];
    return {
      query,
      total: clients.length + orderMatches.length,
      clients,
      orderMatches,
    };
  }

  private async findClientsByOrder(query: string) {
    try {
      const order = await this.orders.get(query.replace("#", ""));
      return [
        {
          orderId: order.orderId,
          name: order.clientName,
          phone: order.phone,
          instagram: order.instagram,
        },
      ];
    } catch {
      return [];
    }
  }

  async getById(id: string) {
    if (!id) throw badRequest("Нужен ID клиента");
    const doc = await this.firebase.db().collection("contacts").doc(id).get();
    return doc.exists ? normalizeClient(doc.id, doc.data() || {}) : null;
  }
}
