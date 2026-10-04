import type { Metadata } from "next";
import { LegalPageView } from "../legal-page";

export const metadata: Metadata = { title: "Política de privacidad", description: "Qué recoge Guildbook, por qué, quién puede verlo y qué puedes elegir." };

export default function PrivacyPage() {
  return <LegalPageView doc="privacy" />;
}
