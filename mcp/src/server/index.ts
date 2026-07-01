import { createApp } from "./app.js";
import { createContainer } from "./container.js";

const container = createContainer();
const app = createApp(container);

app.listen(container.config.port, () => {
  container.logger.info("YBCRM MCP server started", {
    port: container.config.port,
    docs: `http://localhost:${container.config.port}/docs`,
    mcp: `http://localhost:${container.config.port}/mcp`,
  });
});
