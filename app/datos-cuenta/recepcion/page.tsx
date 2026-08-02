import type { Metadata } from "next";
import { BankApp } from "../../components/BankApp";

export const metadata: Metadata = { title: "Destinatarios globales" };

export default function AccountPaymentDataPage() {
  return <BankApp view="account-payment-data" />;
}
