"use client";

import { useEffect, useRef } from "react";
import type { DashboardData } from "@/lib/types";
import { initDashboard } from "@/lib/dashboardClient";

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
          <div className="filter-box">
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
        <div className="tab active" data-tab="summary">
          ① Summary
        </div>
        <div className="tab" data-tab="category">
          ② 계정별
        </div>
        <div className="tab" data-tab="evcs">
          ③ EVCS
        </div>
        <div className="tab" data-tab="alloc">
          ④ 배부판
        </div>
      </div>

      {/* ===================== SUMMARY TAB ===================== */}
      <div id="tab-summary" className="content active">
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

        <div className="chart-2col">
          <div className="tbl-box" style={{ marginBottom: 0 }}>
            <div className="tbl-hd">
              본사 · 법인 요약 <span className="sub" id="sumTblSub" />
            </div>
            <div id="hqSummaryTable" />
          </div>
          <div className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-hd">
              <div>
                <div className="panel-title">본사 · 법인 비교</div>
                <div className="panel-sub">백만원</div>
              </div>
              <div className="legend" id="hqLegend" />
            </div>
            <div className="chart-wrap">
              <canvas id="hqChart" />
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

      {/* ===================== CATEGORY TAB ===================== */}
      <div id="tab-category" className="content">
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
        <div id="feeInsight" />
        <div className="tbl-box">
          <div className="tbl-hd">
            조직별 지급수수료 현황{" "}
            <span className="sub">대상 계정: 지급수수료, 외주개발용역비, 인증대행료, 특허처리비 · 본사 부문별(Staff부문은 대조직까지 세분화) · 법인</span>
          </div>
          <div id="feeTable" />
        </div>
      </div>

      {/* ===================== EVCS TAB ===================== */}
      <div id="tab-evcs" className="content">
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
        <div id="certAlert" />
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
          <div className="chart-wrap-lg">
            <canvas id="certComboChart" />
          </div>
        </div>
      </div>

      {/* ===================== ALLOCATION BOARD TAB ===================== */}
      <div id="tab-alloc" className="content">
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
