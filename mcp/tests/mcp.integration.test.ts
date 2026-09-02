import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

function testContainer() {
  return {
    config: {
      nodeEnv: "test",
      port: 3100,
      mcpServerName: "ybcrm-mcp-test",
      mcpServerVersion: "1.0.0",
      crmJwtSecret: "test-secret-that-is-long-enough",
      firebaseDatabaseId: "production",
      metaGraphVersion: "v23.0",
      crmBaseUrl: "https://ybcrm.ru",
      mcpPublicBaseUrl: "https://ybcrm.ru",
      mcpOAuthPin: "123456",
    },
    logger: { info() {}, warn() {}, error() {} },
    firebase: {},
    orders: {
      list: async (args: unknown) => ({ page: 1, total: 1, args, orders: [{ orderId: "10000" }] }),
      get: async (id: string) => ({ orderId: id }),
      updateStatus: async (id: string, status: string) => ({ orderId: id, status }),
      create: async (args: unknown) => ({ orderId: "MCP-1", args }),
    },
    clients: { search: async (query: string) => ({ query, clients: [] }) },
    analytics: { sales: async () => ({ today: 0 }) },
    instagram: { stats: async () => ({ followers: 1 }) },
    contentAnalytics: { analytics: async () => ({ reels: [] }) },
    finance: { summary: async () => ({ revenue: 0 }) },
    tasks: { create: async (args: unknown) => ({ id: "task-1", ...(args as object) }) },
    dashboard: { get: async () => ({ ok: true }) },
  } as any;
}

function rpcBody(response: request.Response) {
  if (response.body && Object.keys(response.body).length) return response.body;
  const text = String(response.text || "");
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
}

async function authorize(app: ReturnType<typeof createApp>) {
  const verifier = "ybcrm-test-pkce-verifier";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const authorize = await request(app)
    .get("/oauth/authorize")
    .query({
      client_id: "chatgpt-test",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "crm.read crm.write",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      pin: "123456",
    })
    .expect(302);

  const location = new URL(authorize.headers.location);
  expect(location.searchParams.get("state")).toBe("state-1");
  const code = location.searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await request(app)
    .post("/oauth/token")
    .type("form")
    .send({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    .expect(200);

  expect(token.body.token_type).toBe("Bearer");
  expect(token.body.scope).toBe("crm.read crm.write");
  return String(token.body.access_token);
}

describe("MCP HTTP and OAuth integration", () => {
  it("trusts the single Cloud Run proxy hop", () => {
    const app = createApp(testContainer());
    expect(app.get("trust proxy")).toBe(1);
  });

  it("publishes discovery metadata and an RFC 9728 auth challenge", async () => {
    const app = createApp(testContainer());
    const metadata = await request(app).get("/.well-known/oauth-protected-resource/mcp").expect(200);
    expect(metadata.body.resource).toBe("https://ybcrm.ru/mcp");

    const unauthorized = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "initialize" }).expect(401);
    expect(unauthorized.headers["www-authenticate"]).toContain(
      'resource_metadata="https://ybcrm.ru/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("completes OAuth PKCE and serves MCP tools", async () => {
    const app = createApp(testContainer());
    const token = await authorize(app);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    };

    const initialized = await request(app)
      .post("/mcp")
      .set(headers)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "integration-test", version: "1.0.0" },
        },
      })
      .expect(200);
    expect(rpcBody(initialized).result.serverInfo.name).toBe("ybcrm-mcp-test");

    const tools = await request(app)
      .post("/mcp")
      .set(headers)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
    expect(rpcBody(tools).result.tools.map((tool: any) => tool.name)).toContain("orders.list");

    const call = await request(app)
      .post("/mcp")
      .set(headers)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "orders.list", arguments: { page: 1 } },
      })
      .expect(200);
    expect(JSON.parse(rpcBody(call).result.content[0].text).orders[0].orderId).toBe("10000");
  });
});
