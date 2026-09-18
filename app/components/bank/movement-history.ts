import { safeApiMessage } from "../../lib/client-error";
import { formatVoucherDate, formatVoucherTime } from "./MovementVoucher";
import { contactInitials } from "./contactInitials";
import type {
  Movement,
  MovementHistoryItem,
  StoredAccountMovement,
} from "./types";

export const movements: Movement[] = [];

export const MOVEMENT_HISTORY_CLEARED_KEY = "yape-movement-history-cleared";
export const HISTORY_CLEARED_EVENT = "yape-history-cleared";

const movementColors: Movement["color"][] = [
  "violet",
  "amber",
  "blue",
  "green",
];

function storedMovementToHistoryItem(
  movement: StoredAccountMovement,
  index: number,
): MovementHistoryItem {
  const date = new Date(movement.createdAt);
  const validDate = !Number.isNaN(date.getTime());
  const fullDate = validDate
    ? `${formatVoucherDate(date)} - ${formatVoucherTime(date)}`
    : "Movimiento reciente";
  const shortDate = validDate
    ? `${new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(date)} · ${formatVoucherTime(date)}`
    : "Movimiento reciente";
  const amount = -(movement.amountCents / 100);
  return {
    id: movement.id,
    name: movement.recipientName,
    detail: movement.recipientReference,
    date: fullDate,
    displayDate: shortDate,
    amount,
    amountLabel: `- S/ ${Math.abs(amount).toFixed(2)}`,
    initials: contactInitials(movement.recipientName) || "--",
    color: movementColors[index % movementColors.length],
    securityCode: movement.securityCode,
    operationNumber: movement.operationNumber,
    destination: movement.destination,
    createdAt: movement.createdAt,
  };
}

export function groupStoredMovements(items: MovementHistoryItem[]) {
  const groups = new Map<string, MovementHistoryItem[]>();
  for (const item of items) {
    const date = item.createdAt ? new Date(item.createdAt) : null;
    const rawMonth =
      date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat("es-PE", {
            month: "long",
            year: "numeric",
          }).format(date)
        : "Movimientos recientes";
    const month =
      rawMonth.charAt(0).toLocaleUpperCase("es-PE") + rawMonth.slice(1);
    groups.set(month, [...(groups.get(month) ?? []), item]);
  }
  return Array.from(groups, ([month, groupItems]) => ({
    month,
    items: groupItems,
  }));
}

export async function fetchStoredMovements() {
  const response = await fetch("/api/account/movements", { cache: "no-store" });
  const data = (await response.json()) as {
    ok?: boolean;
    historyCleared?: boolean;
    movements?: StoredAccountMovement[];
    error?: string;
  };
  if (!response.ok || !data.ok || !Array.isArray(data.movements)) {
    throw new Error(safeApiMessage(data.error, "No pudimos cargar los movimientos."));
  }
  return {
    historyCleared: Boolean(data.historyCleared),
    movements: data.movements.map(storedMovementToHistoryItem),
  };
}
