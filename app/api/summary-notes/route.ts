import { NextResponse } from "next/server";
import { saveSummaryNote, SUMMARY_NOTE_BOX_KEYS } from "@/lib/summaryNotes";

export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH = 4000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const { boxKey, month, content } = (body || {}) as { boxKey?: unknown; month?: unknown; content?: unknown };

  if (typeof boxKey !== "string" || !SUMMARY_NOTE_BOX_KEYS.includes(boxKey as any)) {
    return NextResponse.json({ error: "boxKey가 올바르지 않습니다." }, { status: 400 });
  }
  if (typeof month !== "string" || !month.trim()) {
    return NextResponse.json({ error: "month가 올바르지 않습니다." }, { status: 400 });
  }
  if (typeof content !== "string" || content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: `content는 ${MAX_CONTENT_LENGTH}자 이내 문자열이어야 합니다.` }, { status: 400 });
  }

  try {
    await saveSummaryNote(boxKey, month, content);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
