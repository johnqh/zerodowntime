export interface AlertPayload {
  alertId: string;
  watchId: string;
  title: string;
  price: number | null;
  url: string;
  score: number;
  reasoning: string;
  priceVsMedian: number;
}

export interface NotificationChannel {
  name: "fcm" | "sse";
  send(userId: string, alert: AlertPayload): Promise<void>;
}

export interface SseHub {
  subscribe(userId: string): ReadableStream<Uint8Array>;
  publish(userId: string, alert: AlertPayload): void;
  subscriberCount(userId: string): number;
}

export const createSseHub = (): SseHub => {
  const subscribers = new Map<
    string,
    Set<ReadableStreamDefaultController<Uint8Array>>
  >();
  const encoder = new TextEncoder();

  const drop = (
    userId: string,
    controller: ReadableStreamDefaultController<Uint8Array>
  ): void => {
    const set = subscribers.get(userId);
    if (!set) return;
    set.delete(controller);
    if (set.size === 0) subscribers.delete(userId);
  };

  return {
    subscribe(userId) {
      // Captured so cancel() removes only this subscriber, never anyone else's.
      let own: ReadableStreamDefaultController<Uint8Array> | null = null;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          own = controller;
          const set = subscribers.get(userId) ?? new Set();
          set.add(controller);
          subscribers.set(userId, set);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          if (own) drop(userId, own);
          own = null;
        },
      });
    },

    publish(userId, alert) {
      const set = subscribers.get(userId);
      if (!set) return;

      const frame = encoder.encode(
        `event: deal-alert\ndata: ${JSON.stringify(alert)}\n\n`
      );
      for (const controller of [...set]) {
        try {
          controller.enqueue(frame);
        } catch {
          drop(userId, controller);
        }
      }
    },

    subscriberCount: (userId) => subscribers.get(userId)?.size ?? 0,
  };
};

export const createSseChannel = (hub: SseHub): NotificationChannel => ({
  name: "sse",
  async send(userId, alert) {
    hub.publish(userId, alert);
  },
});

export interface Dispatcher {
  dispatch(userId: string, alert: AlertPayload): Promise<void>;
}

/**
 * Every channel always fires. One channel failing must never suppress the
 * other — that is the entire point of having two.
 */
export const createDispatcher = (
  channels: NotificationChannel[]
): Dispatcher => ({
  async dispatch(userId, alert) {
    for (const channel of channels) {
      try {
        await channel.send(userId, alert);
      } catch (err) {
        console.warn(
          `[notify] channel ${channel.name} failed: ${(err as Error).message}`
        );
      }
    }
  },
});
