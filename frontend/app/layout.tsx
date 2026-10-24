import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { EH_HML } from "@/lib/env";

import "./globals.css";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "MayaJus · Gestão jurídica",
  description: "Hub de automações (RPAs) — Emissor inteligente de NFS-e em lote, layout 2.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1729" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${dmSans.variable} ${jetbrains.variable} h-full antialiased`}>
      <head>
        {/* aplica estado da sidebar e faixa de ambiente antes da primeira pintura */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('sb-recolhido')==='1')document.documentElement.classList.add('sb-recolhido')}catch(e){}${EH_HML ? "document.documentElement.classList.add('ambiente-hml');" : ""}`,
          }}
        />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
