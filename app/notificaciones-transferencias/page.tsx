import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Notificaciones por yapeo" };

export default function TransferNotificationsPage() {
  return <BankApp view="transfer-alerts" />;
}
