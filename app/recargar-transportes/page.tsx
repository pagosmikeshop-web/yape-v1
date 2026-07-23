import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Recargar Transportes" };

export default function TransportRechargePage() {
  return <BankApp view="transport-recharge" />;
}
