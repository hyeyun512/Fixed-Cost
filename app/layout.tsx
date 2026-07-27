import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "고정비 실적 대시보드 2026",
  description: "Supabase 예산/실적 데이터 기반 고정비 실적 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
