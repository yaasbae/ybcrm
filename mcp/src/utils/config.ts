import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  nodeEnv: z.string().default("development"),
  port: z.coerce.number().int().positive().default(3100),
  mcpServerName: z.string().default("ybcrm-mcp"),
  mcpServerVersion: z.string().default("1.0.0"),
  crmJwtSecret: z.string().min(16, "CRM_JWT_SECRET должен быть минимум 16 символов"),
  firebaseProjectId: z.string().optional(),
  firebaseDatabaseId: z.string().default("production"),
  firebaseServiceAccountJson: z.string().optional(),
  googleApplicationCredentials: z.string().optional(),
  metaAccessToken: z.string().optional(),
  metaIgUserId: z.string().optional(),
  metaGraphVersion: z.string().default("v20.0"),
  crmBaseUrl: z.string().url().default("https://ybcrm.ru"),
  mcpPublicBaseUrl: z.string().url().default("https://ybcrm.ru"),
  mcpOAuthPin: z.string().min(4).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    mcpServerName: process.env.MCP_SERVER_NAME,
    mcpServerVersion: process.env.MCP_SERVER_VERSION,
    crmJwtSecret: process.env.CRM_JWT_SECRET,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID,
    firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    metaIgUserId: process.env.META_IG_USER_ID,
    metaGraphVersion: process.env.META_GRAPH_VERSION,
    crmBaseUrl: process.env.CRM_BASE_URL,
    mcpPublicBaseUrl: process.env.MCP_PUBLIC_BASE_URL,
    mcpOAuthPin: process.env.MCP_OAUTH_PIN,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`MCP config error: ${message}`);
  }

  return parsed.data;
}
