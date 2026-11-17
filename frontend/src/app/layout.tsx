import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Assistant | Local Preview",
  description: "Local development preview of the AI Sales Assistant dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
