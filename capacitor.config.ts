import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor queda preparado para una futura exportación estática del cliente.
 * La aplicación actual usa Next.js SSR, por lo que no existe todavía un
 * bundle local `out/index.html` que pueda sincronizarse con una plataforma
 * nativa. No se utiliza `server.url` y no se crean plataformas nativas en esta
 * etapa.
 */
const config: CapacitorConfig = {
  appId: "com.norathomas.yape",
  appName: "YAPE",
  webDir: "out",
  backgroundColor: "#660185",
  loggingBehavior: "none",
};

export default config;
