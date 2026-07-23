import type { Metadata } from "next";
import { InvitationScreen } from "../components/InvitationScreen";

export const metadata: Metadata = {
  title: "Activar cuenta",
  description: "Crea de forma segura la contraseña de tu cuenta Yape.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ActivateAccountPage() {
  return <InvitationScreen />;
}
