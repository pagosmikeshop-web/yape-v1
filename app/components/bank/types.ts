export type BankView =
  | "home"
  | "movements"
  | "transfer"
  | "services"
  | "recharge"
  | "qr"
  | "personal-qr"
  | "profile"
  | "notifications"
  | "account-data"
  | "account-details"
  | "voucher-editor"
  | "high-amount"
  | "limits"
  | "transfer-alerts"
  | "purchase-approval"
  | "help"
  | "dollars"
  | "insurance"
  | "biometric"
  | "credits"
  | "addresses"
  | "online-purchases"
  | "scanner"
  | "transport-recharge";

export type Movement = {
  id: number | string;
  name: string;
  detail: string;
  date: string;
  amount: number;
  initials: string;
  color: "violet" | "amber" | "blue" | "green";
  securityCode?: string;
  operationNumber?: string;
  destination?: string;
  createdAt?: string;
};

export type ServiceItem = {
  label: string;
  iconSrc?: string;
  iconLottie?: string;
  sticker?: string;
  href?: string;
  badge?: string;
  fullTile?: boolean;
  frameless?: boolean;
};

export type StoredAccountMovement = {
  id: string;
  recipientName: string;
  recipientReference: string;
  destination: string;
  amountCents: number;
  message: string;
  securityCode: string;
  operationNumber: string;
  createdAt: string;
};

export type MovementHistoryItem = Movement & {
  displayDate: string;
  amountLabel: string;
};

export type MovementHistoryGroup = {
  month: string;
  items: MovementHistoryItem[];
};

export type PromoBanner = { id: string; src: string; alt: string };

export type TransferStage =
  | "contact"
  | "new-number"
  | "amount"
  | "amount-processing"
  | "entities"
  | "entity-loading"
  | "confirm"
  | "reject"
  | "confirm-processing"
  | "success";

export type PhoneContact = {
  name: string;
  phone: string;
  initials: string;
};

export type ContactPickerNavigator = Navigator & {
  contacts?: {
    select: (
      properties: Array<"name" | "tel">,
      options: { multiple: boolean },
    ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
  };
};
