import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Mi QR personal" };

export default function PersonalQrPage() {
  return <BankApp view="personal-qr" />;
}
