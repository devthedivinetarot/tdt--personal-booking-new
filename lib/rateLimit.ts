import { createHash } from "crypto";
import { db } from "@/lib/db";

/**
 * Simple fixed-window rate limit kept in Firestore (works across Vercel's serverless instances).
 * Keys are hashed, so no IP address or email is stored. true = allowed.
 * If Firestore can't be reached the request is allowed: a counter problem must never block a real buyer.
 */
export async function allow(bucket: string, id: string, limit: number, windowMs: number): Promise<boolean> {
  if (!id) return true;
  const key = createHash("sha256").update(`${bucket}:${id}`).digest("hex").slice(0, 40);
  const ref = db.doc(`rateLimits/${key}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const d = snap.exists ? (snap.data() as { start?: number; n?: number }) : null;
      if (!d || !d.start || now - d.start > windowMs) {
        // `expiresAt` lets a Firestore TTL policy on rateLimits clean old counters up (optional)
        tx.set(ref, { bucket, start: now, n: 1, expiresAt: new Date(now + windowMs) });
        return true;
      }
      if ((d.n ?? 0) >= limit) return false;
      tx.update(ref, { n: (d.n ?? 0) + 1 });
      return true;
    });
  } catch {
    return true;
  }
}

/** The caller's IP on Vercel (first x-forwarded-for entry). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
}
