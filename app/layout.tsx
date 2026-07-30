import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AppInstallGate } from "./components/AppInstallGate";
import { MobileViewportSync } from "./components/MobileViewportSync";
import { PwaRuntime } from "./components/PwaRuntime";
import { getRouteThemeColor } from "./lib/route-theme";
import "./globals.css";
import "./bank.css";
import "./apk-fidelity.css";
import "./install.css";
import "./client-manager.css";
import "./mobile-viewport.css";

const appIcon = "/assets/apk/icons/ic_yape_logo_r_yape_primary_700.svg";
const androidIcon = "/icons/yape-192.png";
const appleIcon = "/icons/apple-touch-icon.png";
const favicon32 = "/icons/favicon-32.png";
const favicon16 = "/icons/favicon-16.png";

export const metadata: Metadata = {
  applicationName: "Yape",
  title: {
    default: "Acceso seguro",
    template: "%s | Acceso seguro",
  },
  description: "Acceso a la aplicación de banca móvil.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Yape",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: favicon32, type: "image/png", sizes: "32x32" },
      { url: favicon16, type: "image/png", sizes: "16x16" },
      { url: androidIcon, type: "image/png", sizes: "192x192" },
      { url: appIcon, type: "image/svg+xml" },
    ],
    apple: [{ url: appleIcon, type: "image/png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Yape",
  },
};

export async function generateViewport(): Promise<Viewport> {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-pathname") ?? "/";

  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: getRouteThemeColor(pathname),
    interactiveWidget: "resizes-content",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // El nonce de la CSP se genera por solicitud. Leer los encabezados obliga a
  // Next.js a renderizar dinámicamente y a propagar ese nonce a sus scripts.
  const requestHeaders = await headers();
  const themeColor = getRouteThemeColor(
    requestHeaders.get("x-pathname") ?? "/",
  );
  const routeThemeStyle = {
    "--app-route-bg": themeColor,
    backgroundColor: themeColor,
  } as CSSProperties;

  return (
    <html lang="es" style={routeThemeStyle}>
      <body suppressHydrationWarning style={routeThemeStyle}>
        <MobileViewportSync />
        <PwaRuntime />
        <AppInstallGate>{children}</AppInstallGate>
        <SpeedInsights />
      </body>
    </html>
  );
}
