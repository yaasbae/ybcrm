import { describe, expect, it } from "vitest";
import { MemoryAiAuditSink, sanitizeForAudit } from "../src/ai-tools/audit.js";
import { READ_ONLY_PERMISSIONS } from "../src/ai-tools/permissions.js";
import { AiToolLayer } from "../src/ai-tools/tool-layer.js";

function fixture() {
  const audit = new MemoryAiAuditSink();
  const dependencies: any = {
    clients: {
      getById: async (id: string) => ({ id, name: "Иван", raw: { internal: true } }),
      search: async () => ({ clients: [] }),
    },
    orders: {
      get: async (id: string) => ({ id, orderId: id, raw: { token: "secret" } }),
      list: async () => ({ orders: [{ id: "1", raw: { hidden: true } }] }),
    },
    analytics: { sales: async () => ({ today: 10 }) },
    finance: { summary: async () => ({ revenue: 10 }) },
    agentRead: {
      payments: async () => ({ payments: [] }),
      inventory: async () => ({ products: [] }),
      production: async () => ({ entries: [] }),
      tasks: async () => ({ tasks: [] }),
      supplier: async (id: string) => ({ id, found: false }),
      communications: async () => ({ communications: [] }),
    },
  };
  return { audit, layer: new AiToolLayer(dependencies, audit) };
}

const context = {
  agentId: "test-agent",
  userId: "owner",
  permissions: READ_ONLY_PERMISSIONS,
  reason: "Проверить заказ",
};

describe("AiToolLayer", () => {
  it("exposes only the approved read-only foundation tools", () => {
    const { layer } = fixture();
    expect(layer.list().map((tool) => tool.name)).toEqual([
      "get_customer",
      "search_customers",
      "get_order",
      "search_orders",
      "get_sales_summary",
      "get_payments",
      "get_inventory",
      "get_production_status",
      "get_finance_summary",
      "get_tasks",
      "get_supplier",
      "search_communications",
    ]);
  });

  it("removes raw database payloads and writes an audit record", async () => {
    const { layer, audit } = fixture();
    const result = await layer.execute("get_order", { id: "100" }, context) as any;
    expect(result.raw).toBeUndefined();
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      agent_id: "test-agent",
      tool: "get_order",
      status: "success",
      approval_required: false,
    });
  });

  it("denies missing permissions and audits the denial", async () => {
    const { layer, audit } = fixture();
    await expect(layer.execute("get_finance_summary", {}, { ...context, permissions: [] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(audit.records[0].status).toBe("denied");
  });

  it("redacts secrets and fingerprints personal data in audit arguments", () => {
    expect(sanitizeForAudit({ apiToken: "abc", phone: "+79990000000" })).toEqual({
      apiToken: "[REDACTED]",
      phone: expect.objectContaining({ redacted: true }),
    });
  });
});
