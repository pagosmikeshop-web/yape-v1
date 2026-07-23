import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Aprobar compras" };

export default function PurchaseApprovalPage() {
  return <BankApp view="purchase-approval" />;
}
