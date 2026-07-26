const AUTH_ROUTES = new Set([
  "/",
  "/activar-cuenta",
  "/cambiar-contrasena",
  "/cambiar-numero",
  "/recuperar",
  "/registro",
]);

const PURPLE_ROUTES = new Set([
  "/inicio",
  "/editar-voucher",
  "/mi-qr",
  "/qr-personal",
]);

export function getRouteThemeColor(pathname: string) {
  if (AUTH_ROUTES.has(pathname)) return "#35103c";
  if (pathname === "/escanear-qr") return "#08070d";
  if (PURPLE_ROUTES.has(pathname)) return "#742284";
  return "#ffffff";
}
