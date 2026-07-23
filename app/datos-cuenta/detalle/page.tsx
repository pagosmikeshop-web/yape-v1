import type { Metadata } from "next";
import { BankApp } from "../../components/BankApp";

export const metadata: Metadata = { title: "Datos de mi cuenta" };

export default function AccountDetailsPage() {
  return <BankApp view="account-details" />;
}
