import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Container } from "../types/container.js";
import { registerTools } from "./register.js";

export function createMcpServer(container: Container) {
  const server = new McpServer({
    name: container.config.mcpServerName,
    version: container.config.mcpServerVersion,
  });

  registerTools(server, container);
  return server;
}
