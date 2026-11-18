import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Sales Assistant",
  description: "Live AI sales assistant workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Script src="https://telegram.org/js/telegram-web-app.js?65" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
