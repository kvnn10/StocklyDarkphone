/**
 * Root layout: fonts, metadata (SEO), and providers (Query, Auth, Theme, Toaster).
 * Wraps all pages; force-dynamic so useSearchParams and server session work correctly.
 */
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyboardShortcutsProvider } from "@/components/providers/KeyboardShortcutsProvider";
import { SpanishUiProvider } from "@/components/providers/SpanishUiProvider";
import { SpanishCoverageProvider } from "@/components/providers/SpanishCoverageProvider";
import { SpanishPhraseProvider } from "@/components/providers/SpanishPhraseProvider";
import { Poppins } from "next/font/google";
import localFont from "next/font/local";
import React from "react";
import { AuthProvider } from "@/contexts";
import { ShellSsrProvider } from "@/contexts/shell-ssr-context";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { getShellNotificationsForUser } from "@/lib/server/notifications-data";
import { QueryProvider } from "@/lib/react-query";
import "./globals.css";
import "./mobile-menu-fix.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { AuthSessionToasts } from "@/components/shared/AuthSessionToasts";
import { SuppressApiErrorOverlay } from "@/components/shared/SuppressApiErrorOverlay";
import { RouteWarmPrefetch } from "@/components/providers/RouteWarmPrefetch";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono", weight: "100 900" });
const poppins = Poppins({ subsets: ["latin"], variable: "--font-poppins", weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] });

export const dynamic = "force-dynamic";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://stockly-darkphone.vercel.app";

export const metadata = {
  title: {
    default: "Stockly — DarkPhone",
    template: "%s | Stockly — DarkPhone",
  },
  description: "Gestión de inventario y operaciones de DarkPhone.",
  authors: [{ name: "DarkPhone" }],
  creator: "DarkPhone",
  publisher: "DarkPhone",
  applicationName: "Stockly",
  keywords: [
    "DarkPhone",
    "Stockly",
    "inventario",
    "gestión de inventario",
    "productos",
    "proveedores",
    "ventas",
    "operaciones",
    "Barranquilla",
  ],
  icons: {
    icon: "/icon.svg",
    apple: "/icon-180.png?v=2",
    other: [{ rel: "icon", url: "/icon.svg?v=2" }],
  },
  metadataBase: new URL(appUrl),
  openGraph: {
    type: "website",
    locale: "es_CO",
    title: "Stockly — DarkPhone",
    description: "Gestión de inventario y operaciones de DarkPhone.",
    url: appUrl,
    siteName: "Stockly — DarkPhone",
    images: [
      {
        url: "/icon-180.png?v=2",
        width: 180,
        height: 180,
        alt: "Stockly — DarkPhone",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stockly — DarkPhone",
    description: "Gestión de inventario y operaciones de DarkPhone.",
    images: ["/icon-180.png?v=2"],
  },
  robots: { index: true, follow: true },
};

const disableBrowserTranslate = process.env.NEXT_PUBLIC_DISABLE_BROWSER_TRANSLATE === "true";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const initialUser = session ? mapSessionToAppUser(session) : null;
  const shellNotifications = session ? await getShellNotificationsForUser(session.id) : null;

  return (
    <html lang="es" {...(disableBrowserTranslate ? { translate: "no" as const } : {})} suppressHydrationWarning style={{ overscrollBehavior: "none" }} data-scroll-behavior="smooth">
      <body className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} antialiased`} suppressHydrationWarning style={{ overscrollBehavior: "none" }}>
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider initialUser={initialUser}>
              <ShellSsrProvider value={shellNotifications ?? { initialNotifications: undefined, initialUnreadCount: undefined }}>
                <RouteWarmPrefetch />
                <SuppressApiErrorOverlay />
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                  <TooltipProvider delayDuration={200}>
                    <KeyboardShortcutsProvider>
                      <SpanishUiProvider />
                      <SpanishCoverageProvider />
                      <SpanishPhraseProvider />
                      {children}
                      <GlobalSearch />
                    </KeyboardShortcutsProvider>
                  </TooltipProvider>
                </ThemeProvider>
                <Toaster />
                <AuthSessionToasts />
              </ShellSsrProvider>
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
