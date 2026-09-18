import type { AuthUser } from "./types";

export const AUTH_UNLOCK_KEY = "yape-unlocked";

export function rolePath(user: AuthUser) {
  // Una cuenta promovida conserva el acceso a la app; el panel se abre con
  // la misma sesión desde su ruta administrativa.
  if (user.role === "seller" && !user.roles?.includes("client")) return "/vendedor";
  return "/inicio";
}
