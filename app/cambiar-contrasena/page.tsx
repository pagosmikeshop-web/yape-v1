import type { Metadata } from "next";
import { AuthScreen } from "../components/AuthScreen";

export const metadata: Metadata = {
  title: "Restablecer contraseña",
};

export default function ChangePasswordPage() {
  return <AuthScreen screen="change-password" />;
}
