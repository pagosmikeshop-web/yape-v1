import { jsonError } from "@/app/lib/api-utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  void request;
  void context;
  return jsonError("Los restablecimientos se aprueban exclusivamente en el manager de Telegram.", 403);
}
