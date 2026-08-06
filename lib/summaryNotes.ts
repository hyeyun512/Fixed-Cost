import { getSupabaseAdmin } from "./supabaseAdmin";
import type { SummaryNoteBoxKey, SummaryNotes } from "./types";

const TABLE = "dashboard_summary_notes";

export const SUMMARY_NOTE_BOX_KEYS: SummaryNoteBoxKey[] = ["humax_total", "evcs", "humax_detail"];

/** Summary 탭 [Summary] 코멘트 박스 전체를 boxKey -> month -> content 형태로 조회한다. */
export async function loadSummaryNotes(): Promise<SummaryNotes> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select("box_key,month,content");
  if (error) throw new Error(`Summary 노트 조회 실패: ${error.message}`);
  const notes: SummaryNotes = {};
  for (const row of data || []) {
    const r = row as { box_key: string; month: string; content: string };
    (notes[r.box_key] ||= {})[r.month] = r.content;
  }
  return notes;
}

/** 코멘트 박스 하나를 저장(upsert)한다. */
export async function saveSummaryNote(boxKey: string, month: string, content: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(TABLE)
    .upsert({ box_key: boxKey, month, content, updated_at: new Date().toISOString() }, { onConflict: "box_key,month" });
  if (error) throw new Error(`Summary 노트 저장 실패: ${error.message}`);
}
