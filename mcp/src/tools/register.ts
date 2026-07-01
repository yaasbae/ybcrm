import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Container } from "../types/container.js";
import {
  ClientsSearchToolSchema,
  EmptySchema,
  InstagramStatsToolSchema,
  OrderGetToolSchema,
  OrdersListToolSchema,
  OrderUpdateToolSchema,
  TaskCreateToolSchema,
} from "./schemas.js";

function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function registerTools(server: McpServer, container: Container) {
  server.registerTool(
    "orders.list",
    {
      title: "Orders list",
      description: "Получить список заказов из CRM",
      inputSchema: OrdersListToolSchema,
    },
    async (args) => jsonContent(await container.orders.list(args as any)),
  );

  server.registerTool(
    "orders.get",
    {
      title: "Order by ID",
      description: "Получить заказ по ID или номеру заказа",
      inputSchema: OrderGetToolSchema,
    },
    async (args) => jsonContent(await container.orders.get(String(args.id))),
  );

  server.registerTool(
    "orders.update",
    {
      title: "Update order",
      description: "Изменить статус заказа",
      inputSchema: OrderUpdateToolSchema,
    },
    async (args) => jsonContent(await container.orders.updateStatus(String(args.id), String(args.status))),
  );

  server.registerTool(
    "clients.search",
    {
      title: "Search clients",
      description: "Поиск клиента по телефону, имени, Instagram или номеру заказа",
      inputSchema: ClientsSearchToolSchema,
    },
    async (args) => jsonContent(await container.clients.search(String(args.query))),
  );

  server.registerTool(
    "analytics.sales",
    {
      title: "Sales analytics",
      description: "Продажи сегодня, вчера, за неделю, месяц, средний чек, заказы, конверсия",
      inputSchema: EmptySchema,
    },
    async () => jsonContent(await container.analytics.sales()),
  );

  server.registerTool(
    "instagram.stats",
    {
      title: "Instagram stats",
      description: "Статистика Meta Graph API: охват, просмотры, публикации, Reels, подписчики",
      inputSchema: InstagramStatsToolSchema,
    },
    async (args) => jsonContent(await container.instagram.stats(args as any)),
  );

  server.registerTool(
    "content.analytics",
    {
      title: "Content analytics",
      description: "Связка Reels/контента Meta с заказами CRM, деньгами, ROMI и конверсией",
      inputSchema: EmptySchema,
    },
    async () => jsonContent(await container.contentAnalytics.analytics()),
  );

  server.registerTool(
    "finance.summary",
    {
      title: "Finance summary",
      description: "Выручка, прибыль, расходы, зарплаты, аренда и остаток",
      inputSchema: EmptySchema,
    },
    async () => jsonContent(await container.finance.summary()),
  );

  server.registerTool(
    "tasks.create",
    {
      title: "Create task",
      description: "Создать задачу менеджеру",
      inputSchema: TaskCreateToolSchema,
    },
    async (args) => jsonContent(await container.tasks.create(args as any)),
  );

  server.registerTool(
    "dashboard",
    {
      title: "Company dashboard",
      description: "Полная JSON-сводка компании",
      inputSchema: EmptySchema,
    },
    async () => jsonContent(await container.dashboard.get()),
  );
}
