import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Seguro vehicular" };

export default function InsurancePage() {
  return <BankApp view="insurance" />;
}
