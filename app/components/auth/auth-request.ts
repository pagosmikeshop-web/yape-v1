import { createAuthAttemptId, requestAuthJson } from "../../lib/auth-client";

export async function postAuth(
  path: string,
  payload: Record<string, unknown>,
  attemptId = createAuthAttemptId(),
) {
  return requestAuthJson(path, payload, { attemptId });
}
