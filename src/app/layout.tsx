import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
});

export const metadata: Metadata = {
  title: "ระบบตารางสอนอาจารย์",
  description: "ระบบบริหารจัดการตารางสอน การเข้างาน และการลาของอาจารย์มหาวิทยาลัย",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
