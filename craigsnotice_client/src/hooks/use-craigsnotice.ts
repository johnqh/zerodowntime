import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { CreateWatchInput, FeedbackVerdict, Watch } from "@craigsnotice/types";
import {
  CraigsnoticeClient,
  type AlertView,
  type CycleResult,
  type NetworkClient,
} from "../network/craigsnotice-client";
import { queryKeys, STALE_TIMES } from "./query-keys";

export interface ClientContext {
  network: NetworkClient;
  baseUrl: string;
  token: string;
}

const useClient = (ctx: ClientContext): CraigsnoticeClient =>
  useMemo(
    () => new CraigsnoticeClient(ctx.network, ctx.baseUrl),
    [ctx.network, ctx.baseUrl]
  );

export const useWatches = (ctx: ClientContext): UseQueryResult<Watch[]> => {
  const client = useClient(ctx);
  return useQuery({
    queryKey: queryKeys.craigsnotice.watches(),
    queryFn: useCallback(
      () => client.listWatches(ctx.token),
      [client, ctx.token]
    ),
    enabled: !!ctx.token,
    staleTime: STALE_TIMES.WATCHES,
  });
};

export const useAlerts = (ctx: ClientContext): UseQueryResult<AlertView[]> => {
  const client = useClient(ctx);
  return useQuery({
    queryKey: queryKeys.craigsnotice.alerts(),
    queryFn: useCallback(
      () => client.listAlerts(ctx.token),
      [client, ctx.token]
    ),
    enabled: !!ctx.token,
    staleTime: STALE_TIMES.ALERTS,
  });
};

export const useCreateWatch = (
  ctx: ClientContext
): UseMutationResult<Watch, Error, CreateWatchInput> => {
  const client = useClient(ctx);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWatchInput) => client.createWatch(ctx.token, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.craigsnotice.watches() }),
  });
};

export const useDeleteWatch = (
  ctx: ClientContext
): UseMutationResult<void, Error, string> => {
  const client = useClient(ctx);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteWatch(ctx.token, id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.craigsnotice.watches() }),
  });
};

export const useRunWatch = (
  ctx: ClientContext
): UseMutationResult<CycleResult, Error, string> => {
  const client = useClient(ctx);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.runWatch(ctx.token, id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.craigsnotice.alerts() }),
  });
};

export const useSendFeedback = (
  ctx: ClientContext
): UseMutationResult<void, Error, { alertId: string; verdict: FeedbackVerdict }> => {
  const client = useClient(ctx);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, verdict }) =>
      client.sendFeedback(ctx.token, alertId, verdict),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.craigsnotice.alerts() }),
  });
};

export const useRegisterFcmToken = (
  ctx: ClientContext
): UseMutationResult<void, Error, string> => {
  const client = useClient(ctx);
  return useMutation({
    mutationFn: (fcmToken: string) =>
      client.registerFcmToken(ctx.token, fcmToken),
  });
};
