import { jsonOk, readJson } from "@/app/lib/api-utils";
import {
  enforceAuthRateLimits,
  requireUnlockedSession,
} from "@/app/lib/auth-server";
import {
  accountPaymentDataRouteError,
  getAccountPaymentData,
  saveAccountPaymentData,
} from "@/app/lib/account-payment-data-server";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set(["phone", "qrPayload", "acceptAccuracyWarning"]);

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["client"]);
    return jsonOk({ data: await getAccountPaymentData(user.id) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return accountPaymentDataRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["client"]);
    await enforceAuthRateLimits([{
      bucket: "account-payment-data-put",
      subject: user.id,
      limit: 12,
      windowSeconds: 15 * 60,
    }]);
    const body = await readJson(request, { maxBytes: 8 * 1024 });
    const unexpected = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
    if (unexpected.length) {
      return Response.json(
        { ok: false, error: "La solicitud contiene campos no permitidos." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const data = await saveAccountPaymentData(user.id, {
      phone: body.phone,
      qrPayload: body.qrPayload,
      acceptAccuracyWarning: body.acceptAccuracyWarning,
    });
    return jsonOk({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return accountPaymentDataRouteError(error);
  }
}
