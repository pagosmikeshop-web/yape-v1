import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Escanear QR" };

export default function ScannerPage() {
  return <BankApp view="scanner" />;
}
