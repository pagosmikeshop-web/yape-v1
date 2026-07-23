import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Compras por internet" };

export default function OnlinePurchasesPage() {
  return <BankApp view="online-purchases" />;
}
