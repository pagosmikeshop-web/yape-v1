import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Yapear" };

export default function TransferPage() {
  return <BankApp view="transfer" />;
}
