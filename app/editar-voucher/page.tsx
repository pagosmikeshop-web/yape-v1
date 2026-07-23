import type { Metadata } from "next";
import { BankApp } from "../components/BankApp";

export const metadata: Metadata = { title: "Editar voucher" };

export default function VoucherEditorPage() {
  return <BankApp view="voucher-editor" />;
}
