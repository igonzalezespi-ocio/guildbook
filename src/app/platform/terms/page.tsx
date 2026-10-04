import type { Metadata } from "next";
import { LegalPageView } from "../legal-page";

export const metadata: Metadata = { title: "Términos del servicio", description: "Las condiciones para usar Guildbook y sus webs de hermandad." };

export default function TermsPage() {
  return <LegalPageView doc="terms" />;
}
