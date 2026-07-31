import { existsSync } from "node:fs";
import { resolve } from "node:path";

const webDir = process.argv[2] ?? "out";
const indexPath = resolve(webDir, "index.html");

if (!existsSync(indexPath)) {
  console.error(
    `Capacitor necesita un bundle web local con index.html en ${indexPath}. `
      + "El build actual de Next.js es SSR y genera .next, no out/. "
      + "No se puede sincronizar Android sin una exportación estática compatible; "
      + "server.url está deshabilitado para evitar convertirlo en una dependencia remota.",
  );
  process.exit(1);
}

console.log(`Bundle local de Capacitor encontrado: ${indexPath}`);
