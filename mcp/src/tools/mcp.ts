import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AiToolContext } from "../ai-tools/types.js";
import type { Container } from "../types/container.js";
import { registerTools } from "./register.js";

export function createMcpServer(container: Container, context: AiToolContext) {
  const server = new McpServer({
    name: container.config.mcpServerName,
    version: container.config.mcpServerVersion,
  });

  registerTools(server, container, context);
  return server;
}
