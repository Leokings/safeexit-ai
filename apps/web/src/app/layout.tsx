import type { Metadata } from "next";
import { IBM_Plex_Mono, Nunito_Sans } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

const safeExitSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-safeexit-sans",
  display: "swap",
});

const safeExitMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-safeexit-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SAFEEXIT AI | Wallet Incident Response",
    template: "%s | SAFEEXIT AI",
  },
  description: "Non-custodial EVM wallet incident-response workspace.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body className={`${safeExitSans.className} ${safeExitSans.variable} ${safeExitMono.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
