import { describe, it, expect } from "vitest";
import { db } from "./setup";
import { createApp } from "../src/app";
import type { TokenVerifier } from "../src/middleware/firebaseAuth";

const verifier: TokenVerifier = {
  verify: async () => ({ uid: "uid-a", email: "a@x.dev" }),
};

const APP = "http://localhost:5173";

/**
 * The app and the API are on different ports, so every browser call is
 * cross-origin. This was missed entirely by the other tests, which invoke
 * Hono directly and never go through a preflight.
 */
describe("CORS", () => {
  const app = () => createApp({ db, verifier, appOrigins: [APP] });

  it("answers the preflight for a watch create", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "OPTIONS",
      headers: {
        Origin: APP,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(
      res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()
    ).toContain("authorization");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("allows DELETE, which the watch list needs", async () => {
    const res = await app().request("/api/v1/watches/x", {
      method: "OPTIONS",
      headers: {
        Origin: APP,
        "Access-Control-Request-Method": "DELETE",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  });

  it("puts the header on an actual response, not just the preflight", async () => {
    const res = await app().request("/api/v1/watches", {
      headers: { Origin: APP, Authorization: "Bearer tok" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("covers the SSE stream, which EventSource also preflights", async () => {
    const res = await app().request("/api/v1/alerts/stream?ticket=nope", {
      headers: { Origin: APP },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("does not hand its origin header to an unlisted origin", async () => {
    const res = await app().request("/api/v1/watches", {
      headers: { Origin: "https://evil.example", Authorization: "Bearer tok" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "https://evil.example"
    );
  });
});
