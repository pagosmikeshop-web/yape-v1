import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Recargar celular" };

export default function RechargePage() {
  return <BankApp view="recharge" />;
}
