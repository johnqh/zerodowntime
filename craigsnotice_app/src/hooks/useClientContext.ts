import { useMemo } from "react";
import { fetchNetworkClient, type ClientContext } from "@craigsnotice/client";
import { API_BASE_URL } from "../firebase";
import { useAuth } from "../context/AuthContext";

export const useClientContext = (): ClientContext => {
  const { token } = useAuth();
  return useMemo(
    () => ({
      network: fetchNetworkClient,
      baseUrl: API_BASE_URL,
      token: token ?? "",
    }),
    [token]
  );
};
