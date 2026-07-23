import type { Metadata } from "next";
import { AuthScreen } from "./components/AuthScreen";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function Home() {
  return <AuthScreen screen="login" />;
}
