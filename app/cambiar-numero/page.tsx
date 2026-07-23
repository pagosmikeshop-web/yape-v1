import type { Metadata } from "next";
import { AuthScreen } from "../components/AuthScreen";

export const metadata: Metadata = { title: "Cambio de número" };

export default function ChangeNumberPage() {
  return <AuthScreen screen="change-number" />;
}
