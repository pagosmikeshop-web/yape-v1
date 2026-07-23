import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Mis direcciones" };

export default function AddressesPage() {
  return <BankApp view="addresses" />;
}
