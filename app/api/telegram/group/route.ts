import { authEnv } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configuredUrl = authEnv().TELEGRAM_GROUP_INVITE_URL?.trim() ?? "";
  const fallbackUrl = new URL("/registro", request.url);
  if (!/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/u.test(configuredUrl)) {
    fallbackUrl.searchParams.set("telegram", "missing-group-url");
    return Response.redirect(fallbackUrl, 302);
  }
  return Response.redirect(configuredUrl, 302);
}
