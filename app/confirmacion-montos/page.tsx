import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Confirmación de yapeo alto" };

export default function HighAmountConfirmationPage() {
  return <BankApp view="high-amount" />;
}
