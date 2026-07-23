import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Yapear Servicios" };

export default function ServicesPage() {
  return <BankApp view="services" />;
}
