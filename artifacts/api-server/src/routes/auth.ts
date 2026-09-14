import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { createToken, verifyToken } from "../lib/token";

const router: IRouter = Router();

/**
 * GET /api/auth/status
 * Checks Authorization: Bearer <token> header.
 * In dev mode, always returns authenticated=true.
 */
router.get("/auth/status", (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== "production") {
    res.json({ authenticated: true });
    return;
  }
  // No PIN configured — allow access without a token
  if (!process.env.APP_PIN) {
    res.json({ authenticated: true });
    return;
  }
  const token = extractBearerToken(req);
  const secret = process.env.SESSION_SECRET!;
  res.json({ authenticated: token ? verifyToken(token, secret) : false });
});

/**
 * POST /api/auth/login
 * Body: { pin: string }
 * Returns a signed token on success.
 */
router.post("/auth/login", (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  const expectedPin = process.env.APP_PIN;
  const secret = process.env.SESSION_SECRET!;

  if (!expectedPin) {
    // No PIN configured — allow access
    res.json({ ok: true, token: createToken(secret) });
    return;
  }

  if (pin === expectedPin) {
    res.json({ ok: true, token: createToken(secret) });
  } else {
    res.status(401).json({ ok: false, error: "PINが正しくありません" });
  }
});

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export default router;
