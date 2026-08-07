"use client";

import { useEffect, useRef } from "react";
import type { DashboardData } from "@/lib/types";
import { initDashboard } from "@/lib/dashboardClient";
import { SUMMARY_COMMENTS, SUMMARY_DETAIL_GROUPS, type SummaryCommentKey } from "@/lib/summaryComments";

/**
 * 경영진 보고용 고정 코멘트 — 화면에서 직접 고치지 않고, 텍스트를 받아 summaryComments.ts를 수정해 배포한다.
 * variant="side"는 표 우측에 세로로 붙는 형태, 기본값은 표 위에 가로로 펼치는 형태.
 */
function SummaryCommentBox({
  boxKey,
  accent,
  variant,
}: {
  boxKey: SummaryCommentKey;
  accent: string;
  variant?: "side";
}) {
  return (
    <div className={`summary-callout${variant === "side" ? " summary-callout-side" : ""}`} style={{ borderLeftColor: accent }}>
      <div className="summary-callout-title" style={{ color: accent }}>
        Summary
      </div>
      <ul className="summary-comment-list">
        {SUMMARY_COMMENTS[boxKey].map((line, i) => (
          <li key={i}>
            <span className="summary-comment-dot" style={{ background: accent }} />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard({ data }: { data: DashboardData }) {
  const mounted = useRef(false);

  useEffect(() => {
    // React StrictMode in dev runs effects twice; guard so we don't double-init.
    const cleanup = initDashboard(data);
    mounted.current = true;
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            고정비 실적 대시보드 2026
          </div>
          <div className="topbar-meta" id="topbarMeta">
            단위: 백만원
          </div>
        </div>
        <div className="topbar-right">
          <div className="filter-box">
            <label>보고 월</label>
            <select id="monthSelect" defaultValue={data.defaultMonth} />
          </div>
          <div className="filter-box" id="modeFilterBox">
            <label>보기</label>
            <div className="seg" id="modeToggle">
              <button className="seg-btn active" data-mode="month" type="button">
                당월
              </button>
              <button className="seg-btn" data-mode="cum" type="button">
                누계(YTD)
              </button>
            </div>
          </div>
          <span className="tag" id="genTag">
            Supabase 실시간 연동
          </span>
        </div>
      </div>

      <div className="tab-bar">
        <div className="tab tab-summary-lv active" data-tab="sum-total">
          ① Humax합계
        </div>
        <div className="tab tab-summary-lv" data-tab="sum-evcs">
          ② EVCS사업부
        </div>
        <div className="tab tab-summary-lv" data-tab="sum-detail">
          ③ Humax합계_상세
        </div>
        <div className="tab-sep" />
        <div className="tab tab-sub" data-tab="summary">
          Appendix A
        </div>
        <div className="tab tab-sub" data-tab="evcs">
          Appendix B
        </div>
        <div className="tab tab-sub" data-tab="category">
          Appendix C
        </div>
        <div className="tab tab-sub" data-tab="alloc">
          Appendix D
        </div>
      </div>

      {/* ===================== SUMMARY① Humax합계 ===================== */}
      <div id="tab-sum-total" className="content active">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" style={{ background: "#1d4ed8" }} />
          <div>
            <div className="sheet-eyebrow">Summary ①</div>
            <div className="sheet-title">Humax합계</div>
          </div>
        </div>
        <div className="sum-block">
          <div className="sum-block-row">
            <div className="tbl-box" style={{ marginBottom: 0 }}>
              <div className="tbl-hd">
                당월 <span className="sub" id="sumTotalMonthSub" />
              </div>
              <div className="tbl-scroll">
                <div id="sumTotalMonthTable" />
              </div>
            </div>
            <div className="donut-box">
              <div className="donut-wrap">
                <canvas id="sumTotalMonthDonut" />
              </div>
              <ul className="donut-legend" id="sumTotalMonthDonutLegend" />
            </div>
          </div>
          <SummaryCommentBox boxKey="humax_total_month" accent="#1d4ed8" variant="side" />
        </div>

        <div className="sum-block">
          <div className="sum-block-row">
            <div className="tbl-box" style={{ marginBottom: 0 }}>
              <div className="tbl-hd">
                당월 누계 <span className="sub" id="sumTotalCumSub" />
              </div>
              <div className="tbl-scroll">
                <div id="sumTotalCumTable" />
              </div>
            </div>
            <div className="donut-box">
              <div className="donut-wrap">
                <canvas id="sumTotalCumDonut" />
              </div>
              <ul className="donut-legend" id="sumTotalCumDonutLegend" />
            </div>
          </div>
          <SummaryCommentBox boxKey="humax_total_cum" accent="#1d4ed8" variant="side" />
        </div>
      </div>

      {/* ===================== SUMMARY② EVCS사업부 ===================== */}
      <div id="tab-sum-evcs" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" style={{ background: "#1d4ed8" }} />
          <div>
            <div className="sheet-eyebrow">Summary ②</div>
            <div className="sheet-title">EVCS사업부</div>
          </div>
        </div>
        <SummaryCommentBox boxKey="evcs" accent="#1d4ed8" />

        <div className="evcs-top">
          <div className="evcs-top-left">
            <div className="section-lead" style={{ marginTop: 0 }}>
              국내 · 해외 배부 현황 <span className="sub" id="evcsSplitSub" />
            </div>
            <div className="tbl-box" style={{ marginBottom: 0 }}>
              <div id="evcsSplitTable" />
            </div>
          </div>
          <div className="evcs-top-right">
            <div className="section-lead" style={{ marginTop: 0 }}>
              구분별 금액 규모 <span className="sub" id="sumEvcsSub" />
            </div>
            <div className="donut-pair">
              {(["Hq", "Corp"] as const).map((key) => (
                <div className="donut-box donut-card" key={key}>
                  <div className="donut-card-title">{key === "Hq" ? "본사" : "법인"}</div>
                  <div className="donut-card-body">
                    <div className="donut-wrap">
                      <canvas id={`evcsDonut${key}`} />
                    </div>
                    <ul className="donut-legend" id={`evcsDonut${key}Legend`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="section-lead">
          국내 · 해외 월별 실적 추이 <span className="sub" id="evcsTrendSub" />
        </div>
        <div className="panel evcs-trend-panel">
          <div className="panel-hd evcs-trend-hd">
            <div className="legend">
              <span className="leg">
                <span className="leg-line" style={{ borderColor: "#0f172a" }} />
                합계
              </span>
              <span className="leg">
                <span className="leg-line" style={{ borderColor: "#1d4ed8" }} />
                국내
              </span>
              <span className="leg">
                <span className="leg-line" style={{ borderColor: "#94a3b8" }} />
                해외
              </span>
            </div>
          </div>
          <div className="evcs-trend-wrap">
            <canvas id="evcsTrendChart" />
          </div>
        </div>
      </div>

      {/* ===================== SUMMARY③ Humax합계_상세 ===================== */}
      <div id="tab-sum-detail" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" style={{ background: "#1d4ed8" }} />
          <div>
            <div className="sheet-eyebrow">Summary ③</div>
            <div className="sheet-title">Humax합계_상세</div>
          </div>
        </div>
        <div className="summary-row">
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              본사 · 법인 집행 상세 <span className="sub" id="sumDetailSub" />
            </div>
            <div className="tbl-scroll">
              <div id="sumDetailTable" />
            </div>
            <div className="note" id="sumDetailNote" />
          </div>
          <div className="detail-side">
            <div className="summary-callout summary-callout-side" style={{ borderLeftColor: "#1d4ed8" }}>
              <div className="summary-callout-title" style={{ color: "#1d4ed8" }}>
                Summary
              </div>
              {SUMMARY_DETAIL_GROUPS.map((g) => (
                <div className="summary-group" key={g.label}>
                  <div className="summary-group-label">{g.label}</div>
                  <ul className="summary-comment-list">
                    {g.lines.map((line, i) => (
                      <li key={i}>
                        <span className="summary-comment-dot" style={{ background: "#1d4ed8" }} />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="summary-mom-title" id="sumDetailMomTitle" />
              <ul className="summary-comment-list" id="sumDetailMomList" />
            </div>

            <div className="panel detail-trend-panel">
              <div className="detail-trend-hd">
                <span className="detail-trend-title">월별 배부액 추이</span>
                <span className="legend">
                  <span className="leg">
                    <span className="leg-line" style={{ borderColor: "#1e3a8a" }} />
                    STB
                  </span>
                  <span className="leg">
                    <span className="leg-line" style={{ borderColor: "#3b82f6" }} />
                    HUMAX(공통)
                  </span>
                  <span className="leg">
                    <span className="leg-line" style={{ borderColor: "#94a3b8" }} />
                    건물
                  </span>
                </span>
              </div>
              <div className="detail-trend-wrap">
                <canvas id="detailAllocTrend" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== APPENDIX A (구 Humax(전사) 상세) ===================== */}
      <div id="tab-summary" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" />
          <div>
            <div className="sheet-eyebrow">Appendix A</div>
            <div className="sheet-title">Humax(전사) 상세</div>
          </div>
        </div>
        <div id="summaryInsight" />
        <div className="kpi-row" id="summaryKpis" />

        <div className="chart-2eq">
          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-hd">
              <div>
                <div className="panel-title">월별 실적 추이 (예산 vs 실적)</div>
                <div className="panel-sub" id="summaryTrendSub">
                  &nbsp;
                </div>
              </div>
              <div className="legend">
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#16a34a" }} />
                  집행률(%)
                </span>
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#cbd5e1" }} />
                  예산
                </span>
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#2563eb" }} />
                  실적
                </span>
              </div>
            </div>
            <div className="chart-wrap-lg">
              <canvas id="summaryTrendChart" />
            </div>
          </div>
          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-hd">
              <div>
                <div className="panel-title">계정과목별 구성비</div>
                <div className="panel-sub" id="summaryDonutSub">
                  &nbsp;
                </div>
              </div>
            </div>
            <div className="chart-wrap-lg">
              <canvas id="summaryDonutChart" />
            </div>
          </div>
        </div>

        <div className="section-lead">
          보고용 부문별 상세<span className="sub">본사(사업/개발/SCM/Media/Staff) · 법인(해외법인별)</span>
        </div>
        <div className="tbl-box">
          <div id="deptTable" />
        </div>
      </div>

      {/* ===================== APPENDIX B (구 EVCS(사업부) 상세) ===================== */}
      <div id="tab-evcs" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" />
          <div>
            <div className="sheet-eyebrow">Appendix B</div>
            <div className="sheet-title">EVCS(사업부) 상세</div>
          </div>
        </div>
        <div id="evcsInsight" />
        <div className="kpi-row" id="evcsKpis" />

        <div className="chart-2eq">
          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-hd">
              <div>
                <div className="panel-title">월별 실적 추이 (예산 vs 실적)</div>
                <div className="panel-sub" id="evcsTrendComboSub">
                  &nbsp;
                </div>
              </div>
              <div className="legend">
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#16a34a" }} />
                  집행률(%)
                </span>
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#cbd5e1" }} />
                  예산
                </span>
                <span className="leg">
                  <span className="leg-dot" style={{ background: "#0891b2" }} />
                  실적
                </span>
              </div>
            </div>
            <div className="chart-wrap-lg">
              <canvas id="evcsTrendComboChart" />
            </div>
          </div>
          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-hd">
              <div>
                <div className="panel-title">계정과목별 구성비</div>
                <div className="panel-sub" id="evcsDonutSub">
                  &nbsp;
                </div>
              </div>
            </div>
            <div className="chart-wrap-lg">
              <canvas id="evcsDonutChart" />
            </div>
          </div>
        </div>

        <div className="tbl-box">
          <div className="tbl-hd">
            구분별 상세 <span className="sub">EVCS 배부 금액(국내+해외) 기준</span>
          </div>
          <div className="tbl-scroll">
            <div id="evcsCatTable" />
          </div>
        </div>

        <div className="section-lead">
          대계정별 상세<span className="sub">EVCS 배부 금액(국내+해외) 기준 · 본사 · 법인 각각</span>
        </div>
        <div className="chart-2col">
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              본사 대계정별 상세 <span className="sub" id="evcsHqMainAccountTblSub" />
            </div>
            <div id="evcsHqMainAccountTable" />
          </div>
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              법인 대계정별 상세 <span className="sub" id="evcsCorpMainAccountTblSub" />
            </div>
            <div id="evcsCorpMainAccountTable" />
          </div>
        </div>

        <div className="section-lead">
          대계정 '인증대행료' 상세 관리<span className="sub">EVCS에 배부된 인증대행료 · 예산 대비 초과 집행 위험 모니터링</span>
        </div>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-hd">
            <div>
              <div className="panel-title">인증대행료 월별 예산·실적·집행률</div>
              <div className="panel-sub" id="certComboSub">
                &nbsp;
              </div>
            </div>
            <div className="legend">
              <span className="leg">
                <span className="leg-dot" style={{ background: "#16a34a" }} />
                집행률(%)
              </span>
              <span className="leg">
                <span className="leg-dot" style={{ background: "#cbd5e1" }} />
                예산
              </span>
              <span className="leg">
                <span className="leg-dot" style={{ background: "#dc2626" }} />
                실적
              </span>
            </div>
          </div>
          <div className="cert-row">
            <div className="cert-chart">
              <canvas id="certComboChart" />
            </div>
            <div className="cert-side" id="certSide" />
          </div>
        </div>
      </div>

      {/* ===================== CATEGORY TAB (Appendix C) ===================== */}
      <div id="tab-category" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" />
          <div>
            <div className="sheet-eyebrow">Appendix C</div>
            <div className="sheet-title">Humax 계정별</div>
          </div>
        </div>
        <div id="catInsight" />
        <div className="tbl-box">
          <div className="tbl-hd">
            구분별 상세 <span className="sub" id="catTblSub" />
          </div>
          <div className="tbl-scroll">
            <div id="categoryTable" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">구분별 예산 vs 실적</div>
              <div className="panel-sub">백만원 · 전사 기준</div>
            </div>
            <div className="legend" id="catLegend" />
          </div>
          <div className="chart-wrap-lg">
            <canvas id="categoryChart" />
          </div>
        </div>

        <div className="section-lead">
          대계정별 상세<span className="sub">본사 · 법인 각각 전체 대계정 기준 실적/예산 · 구분 순으로 묶어서 표시</span>
        </div>
        <div className="chart-2col">
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              본사 대계정별 상세 <span className="sub" id="hqMainAccountTblSub" />
            </div>
            <div id="hqMainAccountTable" />
          </div>
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              법인 대계정별 상세 <span className="sub" id="corpMainAccountTblSub" />
            </div>
            <div id="corpMainAccountTable" />
          </div>
        </div>

        <div className="section-lead">
          지급수수료 상세 관리<span className="sub">주요 계정 기준 · 어디서 더 쓰고 덜 쓰는지 확인</span>
        </div>
        <div id="feeOrgInsight" />
        <div className="tbl-box">
          <div className="tbl-hd">
            조직별 지급수수료 현황{" "}
            <span className="sub">대상 계정: 지급수수료, 외주개발용역비, 인증대행료, 특허처리비 · 본사 부문별(Staff부문은 대조직까지 세분화) · 법인</span>
          </div>
          <div id="feeTable" />
        </div>
      </div>

      {/* ===================== ALLOCATION BOARD TAB (Appendix D) ===================== */}
      <div id="tab-alloc" className="content">
        <div className="sheet-hd">
          <div className="sheet-hd-bar" />
          <div>
            <div className="sheet-eyebrow">Appendix D</div>
            <div className="sheet-title">Humax 배부판</div>
          </div>
        </div>
        <div id="allocTrendInsight" />

        <div className="section-lead">
          예산(BP) 배부 현황<span className="sub" id="allocBudgetSub" />
        </div>
        <div className="tbl-box">
          <div className="alloc-scroll">
            <div id="allocBudgetTable" />
          </div>
        </div>

        <div className="section-lead">
          실적 배부 현황<span className="sub" id="allocActualSub" />
        </div>
        <div className="tbl-box">
          <div className="alloc-scroll">
            <div id="allocActualTable" />
          </div>
        </div>

        <div className="section-lead">
          Diff(실적-예산) 배부 현황<span className="sub" id="allocDiffSub" />
        </div>
        <div className="tbl-box">
          <div className="alloc-scroll">
            <div id="allocDiffTable" />
          </div>
        </div>
      </div>

      <footer>
        고정비 실적 대시보드 2026 · Supabase 실시간 연동 (
        <span id="sourceTableTag">{data.sourceTable}</span>) · 생성 시각{" "}
        <span id="generatedAtTag">{new Date(data.generatedAt).toLocaleString("ko-KR")}</span>
      </footer>
    </>
  );
}
