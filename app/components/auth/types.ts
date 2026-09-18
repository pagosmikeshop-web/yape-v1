export type Screen = "login" | "register" | "change-password" | "recover" | "change-number";

export type Notice = { text: string; tone: "info" | "error" } | null;

export type TelegramValidationPhase =
  | "idle"
  | "loading"
  | "resolving"
  | "error-resolving"
  | "success"
  | "error";

export type AuthUser = {
  id: string;
  sellerCode: string;
  username: string;
  displayName: string;
  role: "admin" | "seller" | "client";
  roles?: Array<"admin" | "seller" | "client">;
  mustChangePassword: boolean;
  mustSetPin: boolean;
  pinSet: boolean;
  unlocked: boolean;
  referralCode?: string | null;
  accessExpiresAt?: string | null;
};

export type AccessLookup = {
  permanent: boolean;
  accessExpiresAt: string | null;
  referralCode: string | null;
  displayName: string;
};

export type RecoveryRequest = {
  id: string;
  sellerId: string;
  username: string;
};

export type RecoveryChallenge = {
  requestId: string;
  token: string;
};
