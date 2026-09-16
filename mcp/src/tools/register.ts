import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AiToolContext } from "../ai-tools/types.js";
import type { Container } from "../types/container.js";

function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerTools(server: McpServer, container: Container, context: AiToolContext) {
  for (const definition of container.aiTools.list()) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema.shape,
        annotations: {
          // Business data is read-only, but the mandatory audit record is a
          // state change. OpenAI's MCP guidance therefore requires false.
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => jsonContent(await container.aiTools.execute(definition.name, args, context)),
    );
  }
}
