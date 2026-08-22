import { describe, it, expect } from "vitest";
import {
  createStreamTicketStore,
  TICKET_TTL_MS,
} from "../src/services/streamTickets";

describe("createStreamTicketStore", () => {
  it("issues an opaque ticket that is not the user id", () => {
    const store = createStreamTicketStore();
    const { ticket, expiresIn } = store.issue("user-1");

    expect(ticket).not.toContain("user-1");
    expect(ticket.length).toBeGreaterThan(32);
    expect(expiresIn).toBe(TICKET_TTL_MS / 1000);
  });

  it("resolves a valid ticket to its user", () => {
    const store = createStreamTicketStore();
    const { ticket } = store.issue("user-1");
    expect(store.consume(ticket)).toBe("user-1");
  });

  it("is single use", () => {
    const store = createStreamTicketStore();
    const { ticket } = store.issue("user-1");

    expect(store.consume(ticket)).toBe("user-1");
    expect(store.consume(ticket)).toBeNull();
  });

  it("rejects an unknown ticket", () => {
    expect(createStreamTicketStore().consume("made-up")).toBeNull();
  });

  it("rejects a ticket past its TTL", () => {
    let clock = 0;
    const store = createStreamTicketStore(() => clock, 30_000);
    const { ticket } = store.issue("user-1");

    clock = 30_001;
    expect(store.consume(ticket)).toBeNull();
  });

  it("issues unique tickets", () => {
    const store = createStreamTicketStore();
    const seen = new Set(
      Array.from({ length: 50 }, () => store.issue("user-1").ticket)
    );
    expect(seen.size).toBe(50);
  });

  it("does not leak one user's stream to another user's ticket", () => {
    const store = createStreamTicketStore();
    const a = store.issue("user-a");
    store.issue("user-b");
    expect(store.consume(a.ticket)).toBe("user-a");
  });

  it("sweeps expired tickets so the store does not grow unbounded", () => {
    let clock = 0;
    const store = createStreamTicketStore(() => clock, 30_000);
    for (let i = 0; i < 10; i += 1) store.issue(`user-${i}`);
    expect(store.size()).toBe(10);

    clock = 60_000;
    expect(store.size()).toBe(0);
  });
});
