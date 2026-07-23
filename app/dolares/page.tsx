import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Dólares" };

export default function DollarsPage() {
  return <BankApp view="dollars" />;
}
