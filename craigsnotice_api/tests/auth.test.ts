import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import {
  createFirebaseAuth,
  type TokenVerifier,
} from "../src/middleware/firebaseAuth";
import { users } from "../src/db/schema";

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t !== "good-token") throw new Error("invalid token");
    return { uid: "firebase-uid-1", email: "demo@craigsnotice.dev" };
  },
};

const appWith = (): Hono => {
  const app = new Hono();
  app.use("/me", createFirebaseAuth(verifier, db));
  app.get("/me", (c) =>
    c.json({ userId: c.get("userId"), email: c.get("userEmail") })
  );
  return app;
};

describe("firebase auth middleware", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a request with no Authorization header", async () => {
    expect((await appWith().request("/me")).status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await appWith().request("/me", {
      headers: { Authorization: "Bearer bad" },
    });
    expect(res.status).toBe(401);
  });

  it("upserts the user on first sight and exposes the internal id", async () => {
    const res = await appWith().request("/me", {
      headers: { Authorization: "Bearer good-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("demo@craigsnotice.dev");

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "firebase-uid-1"));
    expect(rows).toHaveLength(1);
    expect(body.userId).toBe(rows[0]!.id);
  });

  it("does not create a duplicate user on a second request", async () => {
    const app = appWith();
    await app.request("/me", { headers: { Authorization: "Bearer good-token" } });
    await app.request("/me", { headers: { Authorization: "Bearer good-token" } });

    expect(
      await db.select().from(users).where(eq(users.firebaseUid, "firebase-uid-1"))
    ).toHaveLength(1);
  });
});
