import type { Metadata } from "next";
import { AuthScreen } from "../components/AuthScreen";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function RegisterPage() {
  return <AuthScreen screen="register" />;
}
