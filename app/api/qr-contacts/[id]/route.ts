import { requireUnlockedSession } from "@/app/lib/auth-server";
import {
  assertSameOriginMutation,
  deleteQrContact,
  qrJson,
  qrRouteError,
} from "@/app/lib/qr-contact-server";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(request, false);
    const { user } = await requireUnlockedSession(request, ["client"]);
    const { id } = await context.params;
    await deleteQrContact(user.id, id);
    return qrJson({ ok: true });
  } catch (error) {
    return qrRouteError(error);
  }
}
