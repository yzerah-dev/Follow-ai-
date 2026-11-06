import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Follow.AI", template: "%s · Follow.AI" },
  description: "Votre équipe commerciale augmentée par l'intelligence artificielle.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
