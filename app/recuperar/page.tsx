import type { Metadata } from "next";
import { AuthScreen } from "../components/AuthScreen";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

export default function RecoverPage() {
  return <AuthScreen screen="recover" />;
}
