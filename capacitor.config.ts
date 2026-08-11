import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Decisión vigente: este proyecto se entrega como una única web/PWA.
 * Next.js usa SSR, por lo que no existe un bundle local `out/index.html` ni se
 * deben crear o sincronizar plataformas nativas. No se usa `server.url`: una
 * eventual app nativa requeriría primero una arquitectura de exportación
 * estática compatible y una decisión explícita.
 */
const config: CapacitorConfig = {
  appId: "com.norathomas.yape",
  appName: "YAPE",
  webDir: "out",
  backgroundColor: "#660185",
  loggingBehavior: "none",
};

export default config;
