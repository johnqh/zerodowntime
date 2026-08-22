import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { errorResponse } from "@craigsnotice/types";
import type { Db } from "../db";
import { users } from "../db/schema";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
  }
}

export interface TokenVerifier {
  verify(idToken: string): Promise<{ uid: string; email: string }>;
}

export const createFirebaseAuth = (
  verifier: TokenVerifier,
  db: Db
): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json(errorResponse("missing bearer token"), 401);
    }

    let claims: { uid: string; email: string };
    try {
      claims = await verifier.verify(header.slice(7));
    } catch {
      return c.json(errorResponse("invalid token"), 401);
    }

    const [user] = await db
      .insert(users)
      .values({ firebaseUid: claims.uid, email: claims.email })
      .onConflictDoUpdate({
        target: users.firebaseUid,
        set: { email: claims.email },
      })
      .returning();

    const resolved =
      user ??
      (
        await db.select().from(users).where(eq(users.firebaseUid, claims.uid))
      )[0];

    if (!resolved) return c.json(errorResponse("failed to resolve user"), 500);

    c.set("userId", resolved.id);
    c.set("userEmail", resolved.email);
    await next();
  };
};
