export type AppRole = "admin" | "seller" | "client";

export type AuthUser = {
  id: string;
  sellerCode: string;
  username: string;
  displayName: string;
  email: string;
  role: AppRole;
  roles: AppRole[];
  isOwner: boolean;
  ownerId: string | null;
  status: "pending" | "active" | "disabled";
  credits: number;
  referralRedemptionCount: number;
  deviceId: string | null;
  telegramUserId: string | null;
  referralCode: string | null;
  accessExpiresAt: string | null;
  mustChangePassword: boolean;
  mustSetPin: boolean;
  pinSet: boolean;
  unlocked: boolean;
};

export type UserRow = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  email: string;
  role: AppRole;
  roles?: AppRole[];
  is_owner: number;
  owner_id: string | null;
  status: "pending" | "active" | "disabled";
  password_hash: string;
  password_salt: string;
  pin_hash: string | null;
  pin_salt: string | null;
  credits: number;
  device_id: string | null;
  device_public_key: string | null;
  fingerprint_id_hash: string | null;
  telegram_user_id: string | null;
  referral_code: string | null;
  referred_by_user_id: string | null;
  access_expires_at: string | null;
  referral_redemption_count: number;
  must_change_password: number;
  must_set_pin: number;
  deleted_at: string | null;
};

export type SessionRow = {
  session_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  pin_verified_at: string | null;
  unlocked_until: string | null;
} & UserRow;

export type AuthRateLimitRule = {
  bucket: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export type PasswordResetChallenge = {
  requestId: string;
  token: string;
  expiresAt: string;
};
