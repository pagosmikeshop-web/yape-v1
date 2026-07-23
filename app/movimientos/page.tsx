import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Movimientos" };

export default function MovementsPage() {
  return <BankApp view="movements" />;
}
