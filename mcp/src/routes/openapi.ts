export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "YBCRM MCP REST API",
    version: "1.0.0",
    description: "REST слой поверх MCP-инструментов CRM.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        security: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/orders": {
      get: {
        summary: "Список заказов",
        parameters: [
          { name: "date_from", in: "query", schema: { type: "string" } },
          { name: "date_to", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "manager", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Orders list" } },
      },
    },
    "/api/orders/{id}": {
      get: {
        summary: "Заказ по ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Order" } },
      },
      patch: {
        summary: "Изменить статус заказа",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: { status: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Updated order" } },
      },
    },
    "/api/clients/search": {
      get: {
        summary: "Поиск клиента",
        parameters: [{ name: "query", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Clients" } },
      },
    },
    "/api/analytics/sales": {
      get: { summary: "Продажи", responses: { "200": { description: "Sales analytics" } } },
    },
    "/api/instagram/stats": {
      get: { summary: "Instagram / Meta статистика", responses: { "200": { description: "Instagram stats" } } },
    },
    "/api/content/analytics": {
      get: { summary: "Связка контента и заказов", responses: { "200": { description: "Content analytics" } } },
    },
    "/api/finance/summary": {
      get: { summary: "Финансы", responses: { "200": { description: "Finance summary" } } },
    },
    "/api/tasks": {
      post: { summary: "Создать задачу", responses: { "200": { description: "Task" } } },
    },
    "/api/dashboard": {
      get: { summary: "Полная сводка компании", responses: { "200": { description: "Dashboard" } } },
    },
  },
} as const;
