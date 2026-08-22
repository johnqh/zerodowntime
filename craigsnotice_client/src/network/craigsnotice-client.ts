import type {
  ApiResponse,
  CreateWatchInput,
  FeedbackVerdict,
  Watch,
} from "@craigsnotice/types";

/** Injected so no package below the app ever calls fetch directly. */
export interface NetworkClient {
  request<T>(url: string, init?: RequestInit): Promise<T>;
}

export const fetchNetworkClient: NetworkClient = {
  async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    return (await res.json()) as T;
  },
};

/** A watch as the list endpoint returns it, with its running state. */
export interface WatchView extends Watch {
  lastRunAt: string | null;
  runCount: number;
  dealCount: number;
  /** One image per recent deal, for the stack on the watch row. */
  dealImages: string[];
}

export interface AlertView {
  id: string;
  watchId: string;
  title: string;
  price: number | null;
  url: string;
  score: number;
  reasoning: string;
  priceVsMedian: number;
  createdAt: string;
  userFeedback: FeedbackVerdict | null;
  imageUrl: string | null;
}

export interface CycleResult {
  runId: string;
  scrapedCount: number;
  judged: number;
  alerted: number;
  degraded: boolean;
}

export class CraigsnoticeClient {
  constructor(
    private readonly network: NetworkClient,
    private readonly baseUrl: string
  ) {}

  private async call<T>(
    token: string,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await this.network.request<ApiResponse<T>>(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.success) throw new Error(res.error ?? "request failed");
    return res.data as T;
  }

  listWatches = (token: string): Promise<WatchView[]> =>
    this.call<WatchView[]>(token, "/api/v1/watches");

  createWatch = (token: string, input: CreateWatchInput): Promise<Watch> =>
    this.call<Watch>(token, "/api/v1/watches", {
      method: "POST",
      body: JSON.stringify(input),
    });

  deleteWatch = async (token: string, id: string): Promise<void> => {
    await this.call(token, `/api/v1/watches/${id}`, { method: "DELETE" });
  };

  runWatch = (token: string, id: string): Promise<CycleResult> =>
    this.call<CycleResult>(token, `/api/v1/watches/${id}/run`, {
      method: "POST",
    });

  listAlerts = (token: string): Promise<AlertView[]> =>
    this.call<AlertView[]>(token, "/api/v1/alerts");

  sendFeedback = async (
    token: string,
    alertId: string,
    verdict: FeedbackVerdict
  ): Promise<void> => {
    await this.call(token, `/api/v1/alerts/${alertId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ verdict }),
    });
  };

  /**
   * EventSource cannot set headers, so the stream authenticates with an
   * opaque single-use ticket obtained here over an authenticated request.
   */
  streamTicket = (token: string): Promise<{ ticket: string; expiresIn: number }> =>
    this.call<{ ticket: string; expiresIn: number }>(
      token,
      "/api/v1/alerts/stream/ticket",
      { method: "POST" }
    );

  registerFcmToken = async (
    token: string,
    fcmToken: string
  ): Promise<void> => {
    await this.call(token, "/api/v1/users/fcm-token", {
      method: "POST",
      body: JSON.stringify({ fcmToken }),
    });
  };
}
