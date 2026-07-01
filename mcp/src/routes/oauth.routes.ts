import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import type { Config } from "../utils/config.js";

type ClientRecord = {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  issuedAt: number;
};

type AuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope: string;
  expiresAt: number;
};

const clients = new Map<string, ClientRecord>();
const codes = new Map<string, AuthCodeRecord>();

function baseUrl(config: Config) {
  return config.mcpPublicBaseUrl.replace(/\/$/, "");
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function verifyPkce(verifier: string, challenge: string, method = "plain") {
  if (method === "S256") {
    const digest = createHash("sha256").update(verifier).digest("base64url");
    return digest === challenge;
  }
  return verifier === challenge;
}

function issueAccessToken(config: Config, scope: string) {
  return jwt.sign(
    {
      sub: "chatgpt",
      role: "admin",
      aud: "ybcrm-mcp",
      scope,
    },
    config.crmJwtSecret,
    {
      expiresIn: "365d",
      issuer: baseUrl(config),
    },
  );
}

function htmlPage(body: string) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YBCRM MCP</title>
  <style>
    body{margin:0;background:#f6f7f9;color:#1f2937;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:520px;margin:8vh auto;padding:32px;background:#fff;border:1px solid #e6e9ef;border-radius:18px;box-shadow:0 16px 40px rgba(31,41,55,.08)}
    h1{font-size:28px;line-height:1.15;margin:0 0 12px}
    p{color:#6b7280;line-height:1.5}
    input,button{width:100%;height:52px;border-radius:12px;font-size:16px}
    input{border:1px solid #dce1ea;padding:0 14px;box-sizing:border-box}
    button{margin-top:14px;border:0;background:#111827;color:white;font-weight:700;cursor:pointer}
    .hint{font-size:13px;color:#9ca3af}
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function createOAuthRouter(config: Config) {
  const router = Router();

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    const issuer = baseUrl(config);
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: ["crm.read", "crm.write"],
      service_documentation: `${issuer}/docs`,
    });
  });

  const protectedResource = (_req: Request, res: Response) => {
    const issuer = baseUrl(config);
    res.json({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["crm.read", "crm.write"],
    });
  };

  router.get("/.well-known/oauth-protected-resource", protectedResource);
  router.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  router.post("/oauth/register", (req, res) => {
    const redirectUris = toArray(req.body?.redirect_uris);
    const clientId = `ybcrm_${randomBytes(12).toString("hex")}`;
    const record: ClientRecord = {
      clientId,
      redirectUris,
      issuedAt: Math.floor(Date.now() / 1000),
    };
    clients.set(clientId, record);
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: record.issuedAt,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  router.get("/oauth/authorize", (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const clientId = query.client_id;
    const redirectUri = query.redirect_uri;
    const state = query.state;
    const scope = query.scope || "crm.read crm.write";

    if (!clientId || !redirectUri) {
      res.status(400).send(htmlPage("<h1>Не хватает данных</h1><p>ChatGPT не передал client_id или redirect_uri.</p>"));
      return;
    }

    const client = clients.get(clientId);
    if (client && client.redirectUris.length && !client.redirectUris.includes(redirectUri)) {
      res.status(400).send(htmlPage("<h1>Redirect не совпал</h1><p>Адрес возврата не совпадает с зарегистрированным клиентом.</p>"));
      return;
    }

    if (config.mcpOAuthPin && query.pin !== config.mcpOAuthPin) {
      const hidden = Object.entries(query)
        .filter(([key]) => key !== "pin")
        .map(([key, value]) => `<input type="hidden" name="${key}" value="${String(value ?? "").replace(/"/g, "&quot;")}" />`)
        .join("");
      res
        .status(query.pin ? 401 : 200)
        .send(
          htmlPage(`<h1>Подключение YBCRM</h1>
            <p>Введите PIN доступа, чтобы выдать ChatGPT безопасный токен для CRM.</p>
            <form method="get" action="/oauth/authorize">
              ${hidden}
              <input name="pin" autocomplete="one-time-code" placeholder="PIN доступа" autofocus />
              <button type="submit">Подключить</button>
            </form>
            <p class="hint">PIN нужен только при первом подключении MCP.</p>`),
        );
      return;
    }

    const code = randomBytes(24).toString("base64url");
    codes.set(code, {
      clientId,
      redirectUri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      scope,
      expiresAt: Date.now() + 10 * 60_000,
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  router.post("/oauth/token", (req, res) => {
    const grantType = req.body?.grant_type;
    const code = req.body?.code;
    const redirectUri = req.body?.redirect_uri;
    const verifier = req.body?.code_verifier;

    if (grantType !== "authorization_code" || !code) {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    const record = codes.get(code);
    codes.delete(code);

    if (!record || record.expiresAt < Date.now() || record.redirectUri !== redirectUri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    if (record.codeChallenge && !verifyPkce(String(verifier || ""), record.codeChallenge, record.codeChallengeMethod)) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }

    res.json({
      access_token: issueAccessToken(config, record.scope),
      token_type: "Bearer",
      expires_in: 31_536_000,
      scope: record.scope,
    });
  });

  return router;
}
