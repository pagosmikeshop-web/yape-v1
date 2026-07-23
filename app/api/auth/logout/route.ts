import { jsonOk } from "@/app/lib/api-utils";
import { destroySession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cookie = await destroySession(request);
    return jsonOk({}, { headers: { "set-cookie": cookie } });
  } catch (error) {
    return routeError(error);
  }
}
