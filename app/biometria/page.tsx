import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Biometría digital" };

export default function BiometricPage() {
  return <BankApp view="biometric" />;
}
