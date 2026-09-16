export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "YBCRM AI Tool API",
    version: "2.0.0-readonly",
    description: "Read-only REST adapter над единым AI Tool Layer. Запись в CRM на этом этапе отключена.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: { security: [], responses: { "200": { description: "OK" } } },
    },
    "/api/ai-tools": {
      get: {
        summary: "Список разрешенных read-only AI-инструментов",
        responses: { "200": { description: "Tool catalog" } },
      },
    },
    "/api/ai-tools/{name}": {
      post: {
        summary: "Выполнить read-only AI-инструмент",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
        },
        responses: {
          "200": { description: "Tool result" },
          "400": { description: "Validation error" },
          "401": { description: "Authentication required" },
          "403": { description: "Permission denied" },
        },
      },
    },
  },
} as const;
