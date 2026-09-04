import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { activeTenant, themeToCssVars } from "@/config/tenant";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: activeTenant.appName,
  description: `Enterprise Resource Planning for ${activeTenant.productName}`,
  icons: { icon: activeTenant.logo },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      {/* Tenant theme — re-skins the whole app from one config, no rebuild */}
      <head>
        <style>{`:root{${themeToCssVars(activeTenant)}}`}</style>
        {/* Applies the saved day/night choice before first paint, so the page
            never flashes the wrong theme. Falls back to the device setting. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('wb-erp.theme');" +
              "if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))" +
              "document.documentElement.classList.add('dark');}catch(e){}",
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
