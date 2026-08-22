import { randomBytes } from "node:crypto";

/**
 * EventSource cannot set an Authorization header. The first version of this
 * put the Firebase ID token in the query string, which leaks a reusable,
 * hour-long credential into access logs, proxy logs, browser history and
 * Referer headers.
 *
 * Instead the client exchanges its token — over an authenticated request that
 * does carry a header — for an opaque ticket that is single-use, short-lived,
 * and bound to one user.
 */
export interface StreamTicketStore {
  issue(userId: string): { ticket: string; expiresIn: number };
  /** Returns the userId and burns the ticket, or null if invalid/expired/used. */
  consume(ticket: string): string | null;
  size(): number;
}

export const TICKET_TTL_MS = 30_000;

export const createStreamTicketStore = (
  now: () => number = Date.now,
  ttlMs: number = TICKET_TTL_MS
): StreamTicketStore => {
  const tickets = new Map<string, { userId: string; expiresAt: number }>();

  const sweep = (at: number): void => {
    for (const [key, entry] of tickets) {
      if (entry.expiresAt <= at) tickets.delete(key);
    }
  };

  return {
    issue(userId) {
      const at = now();
      sweep(at);

      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, { userId, expiresAt: at + ttlMs });
      return { ticket, expiresIn: Math.floor(ttlMs / 1000) };
    },

    consume(ticket) {
      const at = now();
      const entry = tickets.get(ticket);
      if (!entry) return null;

      // Single use: burn it whether or not it turned out to be expired.
      tickets.delete(ticket);
      if (entry.expiresAt <= at) return null;
      return entry.userId;
    },

    size() {
      sweep(now());
      return tickets.size;
    },
  };
};
