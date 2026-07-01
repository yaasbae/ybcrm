import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = "INTERNAL_ERROR",
  ) {
    super(message);
  }
}

export function notFound(message = "Не найдено") {
  return new AppError(message, 404, "NOT_FOUND");
}

export function badRequest(message = "Некорректный запрос") {
  return new AppError(message, 400, "BAD_REQUEST");
}

export function unauthorized(message = "Нет доступа") {
  return new AppError(message, 401, "UNAUTHORIZED");
}

export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Проверь параметры запроса",
      details: error.flatten(),
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return res.status(500).json({
    error: "INTERNAL_ERROR",
    message,
  });
}
