import type { Metadata, Viewport } from "next";
import { Cinzel, Cinzel_Decorative, Inter } from "next/font/google";
import { Toaster } from "@/components/toaster";
import { GUILDBOOK_DESCRIPTION } from "@/lib/brand";
import "./globals.css";

const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], weight: ["400", "600", "700"] });
const cinzelDecorative = Cinzel_Decorative({
  variable: "--font-cinzel-decorative",
  subsets: ["latin"],
  weight: ["700"],
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

/** Defaults only: the platform layout and each guild's layout set their own titles, icons and previews. */
export const metadata: Metadata = {
  title: { default: "Guildbook", template: "%s | Guildbook" },
  description: GUILDBOOK_DESCRIPTION,
};

export const viewport: Viewport = { themeColor: "#0b0908" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${cinzel.variable} ${cinzelDecorative.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
