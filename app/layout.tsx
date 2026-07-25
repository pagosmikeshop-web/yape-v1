import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AppInstallGate } from "./components/AppInstallGate";
import { MobileViewportSync } from "./components/MobileViewportSync";
import "./globals.css";
import "./bank.css";
import "./apk-fidelity.css";
import "./install.css";
import "./client-manager.css";
import "./mobile-viewport.css";

const appIcon = "/assets/apk/icons/ic_yape_logo_r_yape_primary_700.svg";
const androidIcon = "/icons/yape-192.png";

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
      { url: androidIcon, type: "image/png", sizes: "192x192" },
      { url: appIcon, type: "image/svg+xml" },
    ],
    apple: [{ url: androidIcon, type: "image/png", sizes: "192x192" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7a2185",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // El nonce de la CSP se genera por solicitud. Leer los encabezados obliga a
  // Next.js a renderizar dinámicamente y a propagar ese nonce a sus scripts.
  await headers();
  return (
    <html lang="es">
      <body suppressHydrationWarning>
        <MobileViewportSync />
        <AppInstallGate>{children}</AppInstallGate>
      </body>
    </html>
  );
}
