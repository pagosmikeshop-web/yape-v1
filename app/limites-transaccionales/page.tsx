import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Límites transaccionales" };

export default function TransactionLimitsPage() {
  return <BankApp view="limits" />;
}
