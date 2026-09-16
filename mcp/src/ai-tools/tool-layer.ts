import { z } from "zod";
import type { Container } from "../types/container.js";
import { badRequest } from "../utils/errors.js";
import { requirePermission } from "./permissions.js";
import { sanitizeForAudit, summarizeResult } from "./audit.js";
import type { AiAuditSink, AiToolContext, AiToolDefinition, AiToolName } from "./types.js";

const EmptySchema = z.object({}).strict();
const IdSchema = z.object({ id: z.string().trim().min(1).max(200) }).strict();
const CustomerSearchSchema = z.object({ query: z.string().trim().min(2).max(200) }).strict();
const OrderSearchSchema = z.object({
  dateFrom: z.string().max(20).optional(),
  dateTo: z.string().max(20).optional(),
  status: z.string().max(100).optional(),
  manager: z.string().max(100).optional(),
  blogger: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const PeriodSchema = z.object({
  dateFrom: z.string().max(20).optional(),
  dateTo: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
const SearchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

function withoutRaw<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutRaw) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "raw")
        .map(([key, child]) => [key, withoutRaw(child)]),
    ) as T;
  }
  return value;
}

export class AiToolLayer {
  private readonly definitions: Map<AiToolName, AiToolDefinition>;

  constructor(
    container: Pick<Container, "clients" | "orders" | "analytics" | "agentRead" | "finance">,
    private readonly audit: AiAuditSink,
  ) {
    const definitions: AiToolDefinition[] = [
      {
        name: "get_customer",
        title: "Карточка клиента",
        description: "Получить клиента по внутреннему ID CRM",
        permission: "crm.customers.read",
        inputSchema: IdSchema,
        execute: async ({ id }) => withoutRaw(await container.clients.getById(id)),
      },
      {
        name: "search_customers",
        title: "Поиск клиентов",
        description: "Найти клиентов по имени, телефону, Instagram или номеру заказа",
        permission: "crm.customers.read",
        inputSchema: CustomerSearchSchema,
        execute: async ({ query }) => withoutRaw(await container.clients.search(query)),
      },
      {
        name: "get_order",
        title: "Карточка заказа",
        description: "Получить заказ по ID или номеру",
        permission: "crm.orders.read",
        inputSchema: IdSchema,
        execute: async ({ id }) => withoutRaw(await container.orders.get(id)),
      },
      {
        name: "search_orders",
        title: "Поиск заказов",
        description: "Получить отфильтрованный список заказов",
        permission: "crm.orders.read",
        inputSchema: OrderSearchSchema,
        execute: async (input) => withoutRaw(await container.orders.list(input)),
      },
      {
        name: "get_sales_summary",
        title: "Сводка продаж",
        description: "Получить агрегаты продаж за период",
        permission: "crm.orders.read",
        inputSchema: PeriodSchema.omit({ limit: true }),
        execute: async (input) => container.analytics.sales(input),
      },
      {
        name: "get_payments",
        title: "Платежи",
        description: "Получить безопасную сводку оплат из заказов без банковских секретов",
        permission: "crm.payments.read",
        inputSchema: PeriodSchema,
        execute: async (input) => container.agentRead.payments(input),
      },
      {
        name: "get_inventory",
        title: "Склад и каталог",
        description: "Получить доступные данные каталога и количественных остатков",
        permission: "crm.inventory.read",
        inputSchema: SearchSchema,
        execute: async (input) => container.agentRead.inventory(input),
      },
      {
        name: "get_production_status",
        title: "Статус производства",
        description: "Получить журнал производства за период",
        permission: "crm.production.read",
        inputSchema: PeriodSchema,
        execute: async (input) => container.agentRead.production(input),
      },
      {
        name: "get_finance_summary",
        title: "Финансовая сводка",
        description: "Получить расчетную выручку, расходы и прибыль без доступа к банку",
        permission: "finance.read",
        inputSchema: EmptySchema,
        execute: async () => container.finance.summary(),
      },
      {
        name: "get_tasks",
        title: "Задачи",
        description: "Получить существующие задачи без возможности изменить их",
        permission: "crm.tasks.read",
        inputSchema: SearchSchema,
        execute: async (input) => container.agentRead.tasks(input),
      },
      {
        name: "get_supplier",
        title: "Поставщик",
        description: "Получить поставщика по ID; сейчас сообщает об отсутствии единого справочника",
        permission: "supplier.read",
        inputSchema: IdSchema,
        execute: async ({ id }) => container.agentRead.supplier(id),
      },
      {
        name: "search_communications",
        title: "Поиск переписки",
        description: "Найти сообщения в подключенных каналах связи",
        permission: "crm.communications.read",
        inputSchema: SearchSchema,
        execute: async (input) => container.agentRead.communications(input),
      },
    ];
    this.definitions = new Map(definitions.map((definition) => [definition.name, definition]));
  }

  list(): readonly AiToolDefinition[] {
    return [...this.definitions.values()];
  }

  async execute(name: string, input: unknown, context: AiToolContext): Promise<unknown> {
    const definition = this.definitions.get(name as AiToolName);
    if (!definition) {
      await this.audit.write({
        agent_id: context.agentId,
        user_id: context.userId,
        timestamp: new Date().toISOString(),
        tool: String(name).slice(0, 120),
        arguments: sanitizeForAudit(input || {}),
        reason: context.reason ? String(context.reason).slice(0, 500) : null,
        result: { error: "UNKNOWN_TOOL" },
        status: "denied",
        approval_required: false,
        approval_by: null,
        cost_tokens: context.usage || null,
        duration_ms: 0,
      });
      throw badRequest(`Неизвестный AI-инструмент: ${name}`);
    }
    const startedAt = Date.now();
    let status: "success" | "error" | "denied" = "success";
    let result: unknown;
    try {
      requirePermission(context.permissions, definition.permission);
      const parsed = definition.inputSchema.parse(input || {});
      result = await definition.execute(parsed);
      return result;
    } catch (error) {
      status = error instanceof Error && "code" in error && error.code === "FORBIDDEN" ? "denied" : "error";
      result = { error: error instanceof Error ? error.message : "unknown" };
      throw error;
    } finally {
      await this.audit.write({
        agent_id: context.agentId,
        user_id: context.userId,
        timestamp: new Date().toISOString(),
        tool: definition.name,
        arguments: sanitizeForAudit(input || {}),
        reason: context.reason ? String(context.reason).slice(0, 500) : null,
        result: summarizeResult(result),
        status,
        approval_required: false,
        approval_by: context.approvalBy || null,
        cost_tokens: context.usage || null,
        duration_ms: Date.now() - startedAt,
      });
    }
  }
}
