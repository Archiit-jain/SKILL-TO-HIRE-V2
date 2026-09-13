import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error"
  ) {
    super(message);
  }
}

/** Express 5 forwards rejected promises to the error handler; this just keeps handler typing tidy. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join(".");
    throw new HttpError(400, field ? `${field}: ${first.message}` : first?.message ?? "Invalid input", "validation");
  }
  return result.data;
}
