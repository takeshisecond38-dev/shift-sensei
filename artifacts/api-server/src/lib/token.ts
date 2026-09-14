import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Create a signed auth token using HMAC-SHA256.
 * Format: base64url(payload) + "." + base64url(HMAC signature)
 */
export function createToken(secret: string): string {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS });
  const data = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Verify a token's signature and expiry.
 * Returns true only if the signature is valid and the token has not expired.
 */
export function verifyToken(token: string, secret: string): boolean {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return false;
    const data = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);
    const expectedSig = createHmac("sha256", secret).update(data).digest("base64url");
    // Constant-time comparison to prevent timing attacks
    if (
      sig.length !== expectedSig.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    ) {
      return false;
    }
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
