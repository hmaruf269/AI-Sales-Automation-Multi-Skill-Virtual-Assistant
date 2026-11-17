"use client";

import { ApiProvider } from "@/lib/api/provider";
import { AppGate } from "@/components/app-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApiProvider>
      <AppGate>{children}</AppGate>
    </ApiProvider>
  );
}
