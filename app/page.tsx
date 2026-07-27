import Dashboard from "@/components/Dashboard";
import { loadDashboardData } from "@/lib/aggregate";

// 매 요청마다 새로 조회 (캐시 없음) — Supabase에 새 실적을 올리고 새로고침하면 바로 반영됩니다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  try {
    const data = await loadDashboardData();
    return <Dashboard data={data} />;
  } catch (err: any) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>대시보드 데이터를 불러오지 못했습니다</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16 }}>
          Supabase 연결 또는 환경변수 설정을 확인해주세요 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
        </p>
        <pre
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 16,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            color: "#dc2626",
          }}
        >
          {String(err?.message || err)}
        </pre>
      </div>
    );
  }
}
