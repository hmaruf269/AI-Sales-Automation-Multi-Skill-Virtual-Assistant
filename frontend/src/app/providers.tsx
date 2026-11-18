"use client";

import { useEffect } from "react";
import { ApiProvider } from "@/lib/api/provider";
import { AppGate } from "@/components/app-gate";
import { initializeTelegramMiniApp } from "@/lib/telegram";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => initializeTelegramMiniApp(), []);
  return (
    <ApiProvider>
      <AppGate>{children}</AppGate>
    </ApiProvider>
  );
}
