"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "./client";
import { ApiError } from "./client";
import { HttpApiClient } from "./http-client";
import type { SessionInfo } from "./types";

/**
 * Chooses the data source:
 *  - NEXT_PUBLIC_DATA_MODE=demo  → GitHub Pages static preview only.
 *  - otherwise live: the FastAPI + Hermes stack. No in-browser demo fallback.
 */

const FORCED_DEMO = process.env.NEXT_PUBLIC_DATA_MODE === "demo";

type Phase = "checking" | "ready" | "unauthenticated" | "backend_down";

interface ApiContextValue {
  api: ApiClient;
  phase: Phase;
  session: SessionInfo | null;
  forcedDemo: boolean;
  backendError: string | null;
  retry: () => void;
  enterDemo: () => void;
  exitDemo: () => void;
  resetDemo: () => void;
  onLoggedIn: (s: SessionInfo) => void;
  logout: () => Promise<void>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<ApiClient>(() => new HttpApiClient());
  const [phase, setPhase] = useState<Phase>("checking");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
          },
          mutations: { retry: false },
        },
      }),
  );

  const loadDemo = useCallback(async () => {
    const { DemoApiClient } = await import("@/demo/demo-client");
    const demo = new DemoApiClient();
    setApi(demo);
    setSession(await demo.getSession());
    setPhase("ready");
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("checking");
      if (FORCED_DEMO) {
        await loadDemo();
        return;
      }
      const live = new HttpApiClient();
      try {
        const s = await live.getSession();
        if (cancelled) return;
        setApi(live);
        setSession(s);
        setBackendError(null);
        setPhase(s.authenticated ? "ready" : "unauthenticated");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setApi(live);
          setPhase("unauthenticated");
        } else {
          setBackendError(err instanceof Error ? err.message : "The backend did not respond.");
          setPhase("backend_down");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, loadDemo]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (api.mode === "live") {
        setSession(null);
        setPhase("unauthenticated");
        queryClient.clear();
      }
    };
    window.addEventListener("api:unauthorized", onUnauthorized);
    return () => window.removeEventListener("api:unauthorized", onUnauthorized);
  }, [api, queryClient]);

  const value = useMemo<ApiContextValue>(
    () => ({
      api,
      phase,
      session,
      forcedDemo: FORCED_DEMO,
      backendError,
      retry: () => setAttempt((n) => n + 1),
      enterDemo: () => setAttempt((n) => n + 1),
      exitDemo: () => {
        queryClient.clear();
        setApi(new HttpApiClient());
        setAttempt((n) => n + 1);
      },
      resetDemo: () => {
        const maybe = api as ApiClient & { reset?: () => void };
        maybe.reset?.();
        queryClient.invalidateQueries();
      },
      onLoggedIn: (s) => {
        setSession(s);
        setPhase("ready");
        queryClient.invalidateQueries();
      },
      logout: async () => {
        try {
          await api.logout();
        } catch {
          /* session may already be gone */
        }
        setSession(null);
        setPhase("unauthenticated");
        queryClient.clear();
        setApi(new HttpApiClient());
      },
    }),
    [api, phase, session, backendError, queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function useApiContext() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApiContext must be used inside <ApiProvider>");
  return ctx;
}

export function useApi() {
  return useApiContext().api;
}

export function useIsDemo() {
  return useApiContext().api.mode === "demo";
}
