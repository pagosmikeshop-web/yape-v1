import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Centro de ayuda" };

export default function HelpPage() {
  return <BankApp view="help" />;
}
