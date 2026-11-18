export function telegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function initializeTelegramMiniApp(): () => void {
  const app = telegramWebApp();
  if (!app) return () => undefined;
  document.documentElement.classList.add("telegram-mini-app");
  document.documentElement.dataset.telegramPlatform = app.platform || "unknown";
  app.ready();
  app.expand();
  try {
    app.setHeaderColor("bg_color");
    app.setBackgroundColor("bg_color");
  } catch {
    // Older Telegram clients may not support color keywords.
  }
  const syncTheme = () => {
    document.documentElement.dataset.telegramTheme = app.colorScheme;
  };
  syncTheme();
  app.onEvent("themeChanged", syncTheme);
  return () => app.offEvent("themeChanged", syncTheme);
}
