import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Créditos" };

export default function CreditsPage() {
  return <BankApp view="credits" />;
}
