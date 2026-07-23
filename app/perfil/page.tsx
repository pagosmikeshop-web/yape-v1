import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Mi perfil" };

export default function ProfilePage() {
  return <BankApp view="profile" />;
}
