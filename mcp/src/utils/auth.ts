import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { unauthorized } from "./errors.js";
import type { Config } from "./config.js";

export interface AuthRequest extends Request {
  user?: {
    sub?: string;
    email?: string;
    role?: string;
  };
}

export function authMiddleware(config: Config) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const publicBaseUrl = config.mcpPublicBaseUrl.replace(/\/$/, "");
    const setChallenge = () => {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="YBCRM MCP", resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource/mcp"`,
      );
    };

    if (!token) {
      setChallenge();
      return next(unauthorized("Нужен Bearer JWT токен"));
    }

    try {
      const payload = jwt.verify(token, config.crmJwtSecret) as AuthRequest["user"];
      req.user = payload;
      return next();
    } catch {
      setChallenge();
      return next(unauthorized("JWT токен не прошел проверку"));
    }
  };
}
