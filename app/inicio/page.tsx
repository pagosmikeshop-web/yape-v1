import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Inicio" };

export default function DashboardPage() {
  return <BankApp view="home" />;
}
