import { createClient } from "@supabase/supabase-js";

/**
 * 서버 전용 Supabase 클라이언트 (service_role 키 사용, RLS 우회).
 * 이 파일은 절대 클라이언트 컴포넌트에서 import 하면 안 됩니다.
 * SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두사가 없으므로 브라우저 번들에 포함되지 않습니다.
 */
function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables 에 추가하세요.`
    );
  }
  return v;
}

export function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
