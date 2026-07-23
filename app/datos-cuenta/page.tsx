import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Mis datos" };

export default function AccountDataPage() {
  return <BankApp view="account-data" />;
}
