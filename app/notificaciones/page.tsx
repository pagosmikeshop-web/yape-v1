import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Notificaciones" };

export default function NotificationsPage() {
  return <BankApp view="notifications" />;
}
