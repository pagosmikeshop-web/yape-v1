import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  enforceAuthRateLimits,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import { assertSameOriginMutation, QrContactError } from "@/app/lib/qr-contact-server";
import { requireQrScannerSession, scanQr, QrScanError } from "@/app/lib/qr-scanning-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request, true);
    const { user } = await requireQrScannerSession(request);
    await enforceAuthRateLimits([
      { bucket: "qr-scan-user", subject: user.id, limit: 120, windowSeconds: 60 * 60 },
      { bucket: "qr-scan-ip", subject: await requestIpRateLimitSubject(request), limit: 240, windowSeconds: 60 * 60 },
    ]);
    const record = await readJson(request, { maxBytes: 8 * 1024 });
    if (Object.keys(record).some((key) => !["value", "scanId"].includes(key))) return jsonError("La solicitud contiene campos no permitidos.", 400);
    const result = await scanQr({ user, value: record.value, scanId: asString(record.scanId), request });
    return jsonOk(result, { status: result.status === "valid" ? 200 : 422 });
  } catch (error) {
    if (error instanceof QrScanError) return jsonError(error.message, error.status, error.code);
    if (error instanceof QrContactError) return jsonError(error.message, error.status, error.code);
    return routeError(error);
  }
}
