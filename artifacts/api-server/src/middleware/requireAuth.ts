import type { Request, Response, NextFunction } from "express";
import { extractBearerToken } from "../routes/auth";
import { verifyToken } from "../lib/token";

/**
 * Middleware that requires a valid signed token in the Authorization header.
 * In development mode (NODE_ENV !== 'production'), auth is always bypassed.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  const token = extractBearerToken(req);
  if (token && verifyToken(token, process.env.SESSION_SECRET!)) {
    return next();
  }

  res.status(401).json({ error: "Unauthorized" });
}
