import type { z } from "zod";
import type { Permission } from "./permissions.js";

export type AiToolName =
  | "get_customer"
  | "search_customers"
  | "get_order"
  | "search_orders"
  | "get_sales_summary"
  | "get_payments"
  | "get_inventory"
  | "get_production_status"
  | "get_finance_summary"
  | "get_tasks"
  | "get_supplier"
  | "search_communications";

export interface AiToolContext {
  agentId: string;
  userId: string;
  permissions: readonly Permission[];
  reason?: string;
  approvalBy?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: string;
  };
}

export interface AiToolDefinition {
  name: AiToolName;
  title: string;
  description: string;
  permission: Permission;
  inputSchema: z.ZodObject<any>;
  execute: (input: any) => Promise<unknown>;
}

export interface AiAuditRecord {
  agent_id: string;
  user_id: string;
  timestamp: string;
  tool: string;
  arguments: unknown;
  reason: string | null;
  result: unknown;
  status: "success" | "error" | "denied";
  approval_required: boolean;
  approval_by: string | null;
  cost_tokens: AiToolContext["usage"] | null;
  duration_ms: number;
}

export interface AiAuditSink {
  write(record: AiAuditRecord): Promise<void>;
}
