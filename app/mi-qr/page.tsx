import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Guardar QR" };

export default function QrPage() {
  return <BankApp view="qr" />;
}
