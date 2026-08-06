"use client";

import { Chart, registerables } from "chart.js";
import type {
  DashboardData,
  CategoryRow,
  MainAccountRow,
  AllocationRow,
  AllocValues13,
  SummaryBlock,
  FeeOrgRow,
  EvcsBlock,
} from "./types";

Chart.register(...registerables);

// Chart.js's generics get very strict when mixing dataset types (bar+line combo charts,
// dynamic per-tab chart configs, etc). We intentionally use a loose alias here rather than
// fighting the generic ChartTypeRegistry — the configs are built dynamically at runtime.
type AnyChart = Chart<any, any, any>;

const CATEGORY_COLORS: Record<string, string> = {
  인건비: "#2563eb",
  여비교통비: "#7c3aed",
  감가상각비: "#16a34a",
  지급수수료: "#d97706",
  광고선전비: "#dc2626",
  기타: "#0891b2",
};
const FALLBACK_PALETTE = ["#0ea5e9", "#f472b6", "#a3e635", "#fb923c", "#818cf8"];
function colorFor(cat: string, idx: number): string {
  return CATEGORY_COLORS[cat] || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

const C_ACTUAL = "#2563eb";
const C_BUDGET = "#cbd5e1";
const C_ALT = "#dc2626";
const C_ALT2 = "#f59e0b";

export function initDashboard(data: DashboardData): () => void {
  const months = data.months;
  const allMonths = data.allMonths;
  const trend = data.trend;
  let currentMonth = data.defaultMonth;
  let currentMode: "month" | "cum" = "month";
  // allMonths 기준으로, 실적이 존재하는 마지막 달의 인덱스. 이후 구간이 "미경과 기간".
  const lastActualIdx = allMonths.indexOf(months[months.length - 1]);

  const fmtM = (nVal: number) => Math.round(nVal / 1e6).toLocaleString("ko-KR");
  const cls = (v: number) => (v < 0 ? ' class="neg"' : "");
  const diffCls = (d: number) => (d > 0 ? ' class="neg"' : d < 0 ? ' class="pos"' : "");

  function rateOf(actual: number, budget: number): number | null {
    if (budget === 0) return actual === 0 ? null : Infinity;
    return (actual / budget) * 100;
  }
  // 전사 공통: 예산 초과 = 빨강, 예산 미달 = 파랑. 2가지 색상으로만 표기한다 (노랑/초록 제거).
  function badgeClass(rate: number | null): string {
    if (rate === null) return "bd-gray";
    if (rate === Infinity) return "bd-red";
    if (rate > 100) return "bd-red";
    if (rate < 100) return "bd-blue";
    return "bd-gray";
  }
  function badgeLabel(rate: number | null): string {
    if (rate === null) return "해당없음";
    if (rate === Infinity) return "예산없음";
    return Math.round(rate) + "%";
  }
  function rateBadgeCell(rate: number | null): string {
    return `<span class="kbadge ${badgeClass(rate)}">${badgeLabel(rate)}</span>`;
  }
  /** KPI 카드의 집행률 숫자 자체에 색을 입힌다 (배지를 따로 달면 같은 값이 두 번 보인다). */
  function rateTextClass(rate: number | null): string {
    if (rate === null) return "";
    if (rate === Infinity || rate > 100) return "neg";
    if (rate < 100) return "pos";
    return "";
  }
  /** 비고에 "유의미한 차이"로 볼 최소 금액. 본사/법인 모두 동일 기준 적용. */
  const REMARK_MIN_DIFF_WON = 30_000_000;
  /**
   * "비고"란에 표시할, 차이를 만든 원인 항목 1~2개를 찾는다.
   * 차이 금액이 REMARK_MIN_DIFF_WON(3천만원) 이상일 때만 "유의미"로 보고 채운다.
   * 원인 후보(byLabel)는 상위 항목과 같은 방향(초과/미달)으로 기여한 것 중 금액이 큰 순으로 최대 2개.
   * 초과(+)는 빨강, 미달(-)은 초록으로 통일해서 표기한다.
   * 반대 방향(상쇄) 항목의 합이 그 자체로 유의미한 금액이면 — 즉 같은 방향 항목만 보여줄 경우
   * 독자가 실제 차이보다 크게 오해할 수 있는 상황이면 — 상쇄 항목도 최대 2개까지 함께 짚어준다.
   */
  function attributionRemark(byLabel: { label: string; actual: number; budget: number }[], actual: number, budget: number): string {
    const diff = actual - budget;
    if (diff === 0 || Math.abs(diff) < REMARK_MIN_DIFF_WON) return "";
    const sign = diff > 0 ? 1 : -1;
    const items = byLabel.map((b) => ({ label: b.label, diff: b.actual - b.budget }));
    const fmtItem = (c: { label: string; diff: number }) =>
      `<span class="${c.diff >= 0 ? "neg" : "pos"}">${c.label} ${c.diff >= 0 ? "+" : ""}${fmtM(c.diff)}백만원</span>`;
    const contributors = items
      .filter((b) => Math.sign(b.diff) === sign)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 2);
    if (!contributors.length) return "";
    const mainText = contributors.map(fmtItem).join(", ");

    const offsetters = items
      .filter((b) => Math.sign(b.diff) === -sign)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const offsetSum = offsetters.reduce((s, b) => s + b.diff, 0);
    if (Math.abs(offsetSum) < REMARK_MIN_DIFF_WON) return mainText;

    const offsetText = offsetters.slice(0, 2).map(fmtItem).join(", ");
    return `${mainText} (반면 ${offsetText} 등으로 상쇄)`;
  }
  /**
   * 누계 보기에서, 조직의 지급수수료 계열 차이가 특정 한 달에 쏠려 발생했는지 확인해 별도로 짚어준다.
   * 전체 차이의 절반 이상을 단일 월이 차지할 때만 "집중 발생"으로 보고 표기한다 (당월 보기에서는 표기하지 않음).
   */
  function feeOrgMonthNote(monthly: { month: string; actual: number; budget: number }[], totalDiff: number): string {
    if (currentMode !== "cum" || monthly.length < 2) return "";
    if (Math.abs(totalDiff) < REMARK_MIN_DIFF_WON) return "";
    const sign = totalDiff > 0 ? 1 : -1;
    const top = monthly
      .map((mo) => ({ month: mo.month, diff: mo.actual - mo.budget }))
      .filter((mo) => Math.sign(mo.diff) === sign)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (!top || Math.abs(top.diff) < REMARK_MIN_DIFF_WON || Math.abs(top.diff) < Math.abs(totalDiff) * 0.5) return "";
    return `, <span style="color:#94a3b8">${top.month}에 ${top.diff >= 0 ? "+" : ""}${fmtM(top.diff)}백만원 집중 발생</span>`;
  }
  /** "11 급여" -> "급여"처럼 대계정(re) 코드 앞자리 숫자를 뗀 표시용 이름. */
  function stripAccountNumber(acc: string): string {
    return acc.replace(/^\d+\s*/, "");
  }
  /** "5. Staff부문" -> "Staff부문"처럼 구분(re) 앞의 번호를 뗀 표시용 이름. */
  function stripDeptNumber(dept: string): string {
    return dept.replace(/^\d+\.\s*/, "");
  }
  /** 받침 유무에 따라 "은"/"는" 조사를 고른다 (예: 본사는, 법인은). */
  function josaEunNeun(word: string): "은" | "는" {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return "는";
    return code % 28 !== 0 ? "은" : "는";
  }
  /** 받침 유무에 따라 "로"/"으로" 조사를 고른다 (받침 없음/ㄹ받침 -> 로, 그 외 -> 으로). */
  function josaRoEuro(word: string): "로" | "으로" {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return "로";
    const final = code % 28;
    return final === 0 || final === 8 ? "로" : "으로";
  }
  /**
   * 요약 코멘트 공통 생성기. Summary/계정별/EVCS 탭 모두 이 순서로 원인을 추적한다:
   * 총합계 집행률 확인 → 본사/법인 중 괴리가 큰 쪽 확인 → 그 안에서 구분(re, 부서/법인사) 확인 → 그 구분의 주요 대계정 확인.
   * (계정별 탭은 SummaryBlock을, EVCS 탭은 evcsSummary(EVCS 배부금 기준 SummaryBlock)를 그대로 재사용한다.)
   */
  function drillDownSummary(scopeLabel: string, s: SummaryBlock): string {
    const totalDiff = s.total.actual - s.total.budget;
    const rate = rateOf(s.total.actual, s.total.budget);
    const totalDiffText = ` (${totalDiff >= 0 ? "+" : ""}${fmtM(totalDiff)}백만원 ${totalDiff >= 0 ? "초과" : "미달"})`;
    const overallText =
      rate === null
        ? "집행 실적이 아직 없습니다"
        : rate === Infinity
        ? "예산 없이 집행이 발생했습니다"
        : `전체 집행률은 ${Math.round(rate)}%${totalDiffText}로 ${rate > 105 ? "예산을 다소 초과" : rate < 95 ? "예산 대비 여유 있게" : "예산 범위 내에서 양호하게"} 집행되었습니다`;

    const sides = (["본사", "법인"] as const)
      .map((hq) => {
        const t = s.hq_totals[hq] || { actual: 0, budget: 0 };
        return { hq, actual: t.actual, budget: t.budget, diff: t.actual - t.budget, rate: rateOf(t.actual, t.budget) };
      })
      .filter((h) => h.rate !== null && (h.rate === Infinity || Math.abs(h.rate - 100) >= 5) && Math.abs(h.diff) >= REMARK_MIN_DIFF_WON)
      .sort((a, b) => b.diff - a.diff);

    if (!sides.length) {
      return `<b>${scopeLabel} 전사 실적</b> — ${overallText}. 본사 · 법인 모두 예산 범위 내에서 안정적으로 관리되고 있습니다.`;
    }

    const sentences = sides.map((h) => {
      const over = h.diff > 0;
      const deptRows = s.rows
        .filter((r) => r.hq_corp === h.hq)
        .map((r) => ({ ...r, diff: r.actual - r.budget }))
        .filter((r) => (over ? r.diff > 0 : r.diff < 0))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, 2);

      if (!deptRows.length) {
        return `<b>${h.hq}</b>${josaEunNeun(h.hq)} ${badgeLabel(h.rate)} 집행률로 ${over ? "예산을 초과" : "예산에 미달"} 집행했습니다 (${over ? "+" : ""}${fmtM(h.diff)}백만원).`;
      }

      const parts = deptRows.map((d) => {
        const deptLabel = stripDeptNumber(d.dept);
        const topAccs = d.byMainAccount
          .map((a) => ({ label: stripAccountNumber(a.account), diff: a.actual - a.budget }))
          .filter((a) => Math.sign(a.diff) === Math.sign(d.diff))
          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
          .slice(0, 2)
          .map((a) => a.label);
        return topAccs.length ? `${deptLabel}의 ${topAccs.join(", ")}` : deptLabel;
      });

      return over
        ? `<b>${h.hq}</b>${josaEunNeun(h.hq)} ${parts.join(", ")} 집행이 주요 원인으로 예산 대비 <b>+${fmtM(h.diff)}백만원 초과</b> 집행했습니다.`
        : `<b>${h.hq}</b>${josaEunNeun(h.hq)} ${parts.join(", ")} 집행 미달로 예산 대비 <b>${fmtM(h.diff)}백만원</b> 미달 집행되었습니다.`;
    });

    return `<b>${scopeLabel} 전사 실적</b> — ${overallText}. ${sentences.join(" ")}`;
  }
  /**
   * 조직별 지급수수료 현황 표 위에 붙는 요약 코멘트. 전체 집행률을 먼저 밝히고, 예산 대비 유의미하게
   * 미달/초과된 조직을 방향별로 모두 나열한다 (하나씩만 뽑으면 언급된 금액 합이 전체 차이 금액과
   * 크게 어긋나므로, 임계값 이상인 조직은 빠짐없이 실어 "언급된 금액 합 ≈ 전체 차이"에 가깝게 만든다).
   * Staff부문은 자체 합계 대신 그 하위 대조직(예: "Staff부문의 경영지원실")으로 표기해 더 구체적으로 알려준다.
   */
  function feeOrgSummary(scopeLbl: string, rows: FeeOrgRow[]): string {
    const level0 = rows.filter((r) => r.level === 0);
    const totalAct = level0.reduce((s, r) => s + r.actual, 0);
    const totalBud = level0.reduce((s, r) => s + r.budget, 0);
    const rate = rateOf(totalAct, totalBud);
    const overallText =
      rate === null
        ? "집행 실적이 아직 없습니다"
        : rate === Infinity
        ? "예산 없이 집행이 발생했습니다"
        : `지급수수료 집행률은 ${Math.round(rate)}%로 ${
            rate > 105 ? "예산을 다소 초과" : rate < 95 ? "예산 대비 여유 있게" : "예산 범위 내에서 양호하게"
          } 집행되었습니다`;

    const leaves = rows
      .filter((r) => !(r.level === 0 && r.org === "5. Staff부문"))
      .map((r) => ({ label: r.level === 1 ? `Staff부문의 ${r.org}` : stripDeptNumber(r.org), diff: r.actual - r.budget }))
      .filter((l) => Math.abs(l.diff) >= REMARK_MIN_DIFF_WON);

    const unders = leaves.filter((l) => l.diff < 0).sort((a, b) => a.diff - b.diff);
    const overs = leaves.filter((l) => l.diff > 0).sort((a, b) => b.diff - a.diff);

    if (!unders.length && !overs.length) {
      return `<b>${scopeLbl} 지급수수료 현황</b> — ${overallText}. 조직별로도 예산 범위 내에서 안정적으로 관리되고 있습니다.`;
    }
    const fmtList = (list: { label: string; diff: number }[]) =>
      list.map((l) => `${l.label}(${l.diff >= 0 ? "+" : ""}${fmtM(l.diff)}백만원)`).join(", ");

    const clauses: string[] = [];
    if (unders.length) clauses.push(`미달 원인은 ${fmtList(unders)}이며`);
    if (overs.length) clauses.push(`초과 원인은 ${fmtList(overs)}입니다`);
    const tail = clauses.length === 2 ? clauses.join(", ") : clauses[0].replace(/이며$/, "입니다");

    return `<b>${scopeLbl} 지급수수료 현황</b> — ${overallText}. ${tail}.`;
  }
  /** 전월 대비 증감 배지 (당월 보기에서만 의미가 있음). */
  function momBadgeHtml(current: number, previous: number | null): string {
    if (!previous) return "";
    const momPct = ((current - previous) / previous) * 100;
    const up = momPct > 0;
    return ` <span style="color:${up ? "#dc2626" : "#2563eb"};font-weight:600">${up ? "▲" : "▼"} 전월대비 ${Math.abs(Math.round(momPct))}%</span>`;
  }
  function scopeLabel(): string {
    if (currentMode === "month") return currentMonth + " (당월)";
    return data.byMonth[currentMonth].cumulative.label;
  }
  function getScope() {
    const m = data.byMonth[currentMonth];
    return currentMode === "month" ? m : m.cumulative;
  }

  const el = (id: string) => document.getElementById(id);
  const setHtml = (id: string, html: string) => {
    const e = el(id);
    if (e) e.innerHTML = html;
  };
  const setText = (id: string, text: string) => {
    const e = el(id);
    if (e) e.textContent = text;
  };

  // ============ chart lifecycle ============
  const CHART_BUILDERS: Record<string, Array<() => void>> = {};
  const charts: Record<string, AnyChart> = {};
  function isActive(tabId: string): boolean {
    const e = el("tab-" + tabId);
    return !!e && e.classList.contains("active");
  }
  function destroyChart(id: string) {
    if (charts[id]) {
      try {
        charts[id].destroy();
      } catch {
        /* noop */
      }
      delete charts[id];
    }
  }
  function showChartError(id: string) {
    const canvas = el(id);
    const parent = canvas?.parentElement;
    if (parent && !parent.querySelector(".chart-err")) {
      const div = document.createElement("div");
      div.className = "chart-err";
      div.style.cssText = "font-size:12px;color:#94a3b8;text-align:center;padding-top:40px";
      div.textContent = "차트를 표시할 수 없습니다.";
      parent.appendChild(div);
    }
  }
  function queueChart(tabId: string, id: string, factory: () => AnyChart) {
    const run = () => {
      try {
        destroyChart(id);
        charts[id] = factory();
      } catch (e) {
        console.error("chart build failed:", id, e);
        showChartError(id);
      }
    };
    if (isActive(tabId)) run();
    else (CHART_BUILDERS[tabId] = CHART_BUILDERS[tabId] || []).push(run);
  }

  // Summary①·②는 당월과 누계를 항상 한 화면에 함께 보여주므로 상단 당월/누계 토글이 아무 효과가 없다.
  // 그대로 두면 눌러도 숫자가 안 바뀌어 혼동을 주므로 해당 탭에서는 토글을 숨긴다.
  const MODE_TOGGLE_HIDDEN_TABS = ["sum-total", "sum-evcs"];
  function updateModeToggleVisibility(tabId: string) {
    const box = el("modeFilterBox");
    if (box) box.style.display = MODE_TOGGLE_HIDDEN_TABS.includes(tabId) ? "none" : "";
  }
  function onTabClick(ev: Event) {
    const target = ev.currentTarget as HTMLElement;
    const id = target.dataset.tab!;
    document.querySelectorAll(".content").forEach((c) => c.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    el("tab-" + id)?.classList.add("active");
    target.classList.add("active");
    updateModeToggleVisibility(id);
    requestAnimationFrame(() => {
      (CHART_BUILDERS[id] || []).forEach((fn) => fn());
      CHART_BUILDERS[id] = [];
    });
  }
  const tabEls = Array.from(document.querySelectorAll<HTMLElement>(".tab"));
  tabEls.forEach((t) => t.addEventListener("click", onTabClick));
  updateModeToggleVisibility("sum-total");

  function legendHtml(pairs: [string, string][]): string {
    return pairs
      .map(([color, label]) => `<span class="leg"><span class="leg-dot" style="background:${color}"></span>${label}</span>`)
      .join("");
  }

  /** 실선(실적)/점선(예산)을 함께 쓰는 추이 차트용 범례. */
  function legendLineHtml(items: { color: string; label: string; dashed?: boolean }[]): string {
    return items
      .map(
        ({ color, label, dashed }) =>
          `<span class="leg"><span class="leg-line${dashed ? " dash" : ""}" style="border-color:${color}"></span>${label}</span>`
      )
      .join("");
  }

  function barChart(
    canvasId: string,
    labels: string[],
    actual: number[],
    budget: number[],
    opts: { c1?: string; c2?: string; horizontal?: boolean } = {}
  ): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    const config: any = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "예산", data: budget, backgroundColor: opts.c2 || C_BUDGET, borderRadius: 4 },
          { label: "실적", data: actual, backgroundColor: opts.c1 || C_ACTUAL, borderRadius: 4 },
        ],
      },
      options: {
        indexAxis: opts.horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ctx.dataset.label + ": " + fmtM(ctx.parsed[opts.horizontal ? "x" : "y"] as number) + "백만원",
            },
          },
        },
        scales: opts.horizontal
          ? { x: { ticks: { callback: (v: any) => fmtM(v as number) }, grid: { color: "#f1f5f9" } }, y: { grid: { display: false } } }
          : { y: { ticks: { callback: (v: any) => fmtM(v as number) }, grid: { color: "#f1f5f9" } }, x: { grid: { display: false } } },
      },
    };
    return new Chart(canvas, config);
  }

  function lineChartMulti(canvasId: string, labels: string[], datasets: any[], extraPlugins: any[] = []): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    return new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      plugins: extraPlugins,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y as number | null;
                return ctx.dataset.label + ": " + (v == null ? "-" : fmtM(v) + "백만원");
              },
            },
          },
        },
        scales: { y: { ticks: { callback: (v) => fmtM(v as number) }, grid: { color: "#f1f5f9" } }, x: { grid: { display: false } } },
      },
    });
  }

  /** 아직 실적이 집계되지 않은 "미경과 기간" 구간을 연한 회색으로 칠하는 차트 플러그인. */
  function futureShadePlugin(cutoffIndex: number) {
    return {
      id: "futureShade",
      beforeDraw(chart: any) {
        if (cutoffIndex < 0) return;
        const { ctx, chartArea, scales } = chart;
        const xScale = scales.x;
        if (!xScale || !chartArea) return;
        const startX = Math.max(xScale.getPixelForValue(cutoffIndex + 0.5), chartArea.left);
        const endX = chartArea.right;
        if (startX >= endX) return;
        ctx.save();
        ctx.fillStyle = "rgba(148,163,184,0.18)";
        ctx.fillRect(startX, chartArea.top, endX - startX, chartArea.bottom - chartArea.top);
        ctx.restore();
      },
    };
  }

  /** 예산/실적 막대 + 집행률(%) 라인을 함께 보여주는 콤보 차트 (이중 y축). */
  function comboChart(
    canvasId: string,
    labels: string[],
    actual: (number | null)[],
    budget: number[],
    barColor = C_ACTUAL,
    extraPlugins: any[] = [],
    /** 집행률 축 고정 범위. 값이 100% 부근에 모이는 월별 추이용 기본값이며,
     *  인증대행료처럼 편차가 큰 차트는 null로 넘겨 자동 범위를 쓴다. */
    rateRange: { min: number; max: number } | null = { min: 50, max: 150 }
  ): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    const rates = labels.map((_, i) => {
      const a = actual[i];
      return a != null && budget[i] ? (a / budget[i]) * 100 : null;
    });
    const config: any = {
      plugins: extraPlugins,
      data: {
        labels,
        datasets: [
          { type: "bar", label: "예산", data: budget, backgroundColor: C_BUDGET, borderRadius: 4, yAxisID: "y", order: 2 },
          { type: "bar", label: "실적", data: actual, backgroundColor: barColor, borderRadius: 4, yAxisID: "y", order: 2 },
          {
            type: "line",
            label: "집행률(%)",
            data: rates,
            borderColor: "#16a34a",
            backgroundColor: "#16a34a",
            yAxisID: "y1",
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: "#16a34a",
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                if (ctx.dataset.label === "집행률(%)") {
                  const v = ctx.parsed.y;
                  return v === null ? "집행률: -" : `집행률: ${Math.round(v as number)}%`;
                }
                const v = ctx.parsed.y as number | null;
                return ctx.dataset.label + ": " + (v == null ? "-" : fmtM(v) + "백만원");
              },
            },
          },
        },
        scales: {
          y: { position: "left", ticks: { callback: (v: any) => fmtM(v as number) }, grid: { color: "#f1f5f9" } },
          y1: {
            position: "right",
            // 집행률 축은 기본 50~150%로 고정 — 자동 범위면 눈금 폭이 좁아 100% 기준선에서의 편차가 잘 안 보인다.
            ...(rateRange ? { min: rateRange.min, max: rateRange.max } : {}),
            grid: { drawOnChartArea: false },
            ticks: { callback: (v: any) => Math.round(v as number) + "%" },
          },
          x: { grid: { display: false } },
        },
      },
    };
    return new Chart(canvas, config);
  }

  /** 계정과목별 구성비 도넛 차트. */
  function donutChart(canvasId: string, labels: string[], values: number[], colors: string[]): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const config: any = {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const v = ctx.parsed as number;
                return `${ctx.label}: ${fmtM(v)}백만원 (${((v / total) * 100).toFixed(1)}%)`;
              },
            },
          },
        },
      },
    };
    return new Chart(canvas, config);
  }

  // Summary 시트 전용 파랑 계열 팔레트 (초록 제외) — 배부 항목 6개 순서에 맞춘다.
  const ALLOC_BLUES = ["#1e3a8a", "#1d4ed8", "#3b82f6", "#60a5fa", "#93c5fd", "#94a3b8"];

  /**
   * 반올림해도 합이 정확히 100%가 되도록 비중을 계산한다 (최대잔여법).
   * 단순 반올림만 하면 표시된 비중의 합이 99%나 101%가 되어 보고서에서 어색해진다.
   */
  function pctTo100(values: number[]): number[] {
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) return values.map(() => 0);
    const raw = values.map((v) => (v / total) * 100);
    const floor = raw.map((r) => Math.floor(r));
    let rest = 100 - floor.reduce((a, b) => a + b, 0);
    const order = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac);
    const out = [...floor];
    for (const o of order) {
      if (rest <= 0) break;
      out[o.i] += 1;
      rest -= 1;
    }
    return out;
  }

  /**
   * Summary 도넛 — 가운데에 합계, 각 조각 위에 비중(%)을 직접 그려서 비율과 숫자를 함께 읽히게 한다.
   * (비중이 너무 작은 조각은 글자가 겹치므로 생략하고, 툴팁에서 금액·비중을 확인한다.)
   */
  function allocDonut(canvasId: string, labels: string[], values: number[]): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const pcts = pctTo100(values);
    const centerAndPct = {
      id: "centerAndPct",
      afterDatasetsDraw(chart: any) {
        const { ctx } = chart;
        ctx.save();
        // 조각별 비중(%) — 글자가 들어갈 만큼 두꺼운 조각(4% 이상)에만 표기. 합은 항상 100%가 되도록 계산돼 있다.
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((arc: any, i: number) => {
          if (pcts[i] < 4) return;
          const { x, y } = arc.tooltipPosition();
          ctx.fillStyle = "#fff";
          ctx.font = "700 11px Pretendard, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${pcts[i]}%`, x, y);
        });
        // 가운데 합계
        const cx = (chart.chartArea.left + chart.chartArea.right) / 2;
        const cy = (chart.chartArea.top + chart.chartArea.bottom) / 2;
        ctx.fillStyle = "#94a3b8";
        ctx.font = "600 10px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("합계", cx, cy - 11);
        ctx.fillStyle = "#1a202c";
        ctx.font = "700 17px Pretendard, sans-serif";
        ctx.fillText(fmtM(total), cx, cy + 7);
        ctx.restore();
      },
    };
    const config: any = {
      type: "doughnut",
      plugins: [centerAndPct],
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: ALLOC_BLUES, borderWidth: 2, borderColor: "#fff" }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        layout: { padding: 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => `${ctx.label}: ${fmtM(ctx.parsed as number)}백만원 (${(((ctx.parsed as number) / total) * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    };
    return new Chart(canvas, config);
  }

  /**
   * 도넛 범례. 기본은 항목명만 (옆에 금액 표가 따로 있는 Summary① 용도).
   * values를 주면 비중(%)까지 함께 보여준다 — 조각이 얇아 도넛 위에 못 그린 항목도 비중을 알 수 있고,
   * 표시된 비중의 합이 정확히 100%가 된다.
   */
  function donutLegendHtml(labels: string[], values?: number[]): string {
    const pcts = values ? pctTo100(values) : null;
    return labels
      .map(
        (l, i) =>
          `<li><span class="dleg-dot" style="background:${ALLOC_BLUES[i % ALLOC_BLUES.length]}"></span>` +
          `<span class="dleg-name">${l}</span>${pcts ? `<span class="dleg-pct">${pcts[i]}%</span>` : ""}</li>`
      )
      .join("");
  }

  /** 국내/해외 비중을 월별로 보여주는 그룹-스택 막대 차트 (예산 막대 / 실적 막대를 나란히, 각각 국내+해외로 쌓음). */
  function shareChart(
    canvasId: string,
    labels: string[],
    budgetDom: number[],
    budgetOvs: number[],
    actualDom: number[],
    actualOvs: number[]
  ): AnyChart {
    const canvas = el(canvasId) as HTMLCanvasElement;
    const pct = (v: number, i: number, dom: number[], ovs: number[]) => {
      const total = dom[i] + ovs[i];
      return total ? Math.round((v / total) * 100) : 0;
    };
    const config: any = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "예산-국내", data: budgetDom, backgroundColor: "rgba(8,145,178,0.35)", stack: "예산", borderRadius: 3 },
          { label: "예산-해외", data: budgetOvs, backgroundColor: "rgba(15,23,42,0.3)", stack: "예산", borderRadius: 3 },
          { label: "실적-국내", data: actualDom, backgroundColor: "#0891b2", stack: "실적", borderRadius: 3 },
          { label: "실적-해외", data: actualOvs, backgroundColor: "#0f172a", stack: "실적", borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const i = ctx.dataIndex;
                const v = ctx.parsed.y as number;
                const isActual = ctx.dataset.stack === "실적";
                const dom = isActual ? actualDom : budgetDom;
                const ovs = isActual ? actualOvs : budgetOvs;
                return `${ctx.dataset.label}: ${fmtM(v)}백만원 (${pct(v, i, dom, ovs)}%)`;
              },
            },
          },
        },
        scales: {
          y: { stacked: true, ticks: { callback: (v: any) => fmtM(v as number) }, grid: { color: "#f1f5f9" } },
          x: { stacked: true, grid: { display: false } },
        },
      },
    };
    return new Chart(canvas, config);
  }

  const CHIP_CLASS: Record<string, string> = { 본사: "hq", 법인: "corp", 국내: "dom", 해외: "ovs" };
  function row(label: string, actual: number, budget: number, rowClass = "", hqChip?: string, remark?: string): string {
    const diff = actual - budget;
    const rate = rateOf(actual, budget);
    const nameCell = hqChip ? `<span class="hq-chip ${CHIP_CLASS[hqChip] || "corp"}">${hqChip}</span>${label}` : label;
    // 비고는 span으로 한 번 감싼다 — td에는 max-width/줄 제한이 잘 먹지 않아, 인쇄에서 줄 수를 줄일 때 필요하다.
    const remarkCell = remark === undefined ? "" : `<td class="remark-cell"><span class="remark-clip">${remark}</span></td>`;
    return `<tr class="${rowClass}"><td>${nameCell}</td>
      <td${cls(budget)}>${fmtM(budget)}</td><td${cls(actual)}>${fmtM(actual)}</td>
      <td${diffCls(diff)}>${diff >= 0 ? "+" : ""}${fmtM(diff)}</td>
      <td class="badge-cell">${rateBadgeCell(rate)}</td>${remarkCell}</tr>`;
  }
  function table5(rowsHtml: string, firstColLabel = "구분", extraColLabel?: string): string {
    const extraTh = extraColLabel === undefined ? "" : `<th class="remark-th">${extraColLabel}</th>`;
    return `<table class="pl-tbl"><thead><tr><th>${firstColLabel}</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th>${extraTh}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }
  /** 예산/실적/차이/집행률 4칸 한 세트 (병렬 배치 표에서 그룹 하나를 이룬다). */
  function quadCells(actual: number, budget: number): string {
    const diff = actual - budget;
    return (
      `<td${cls(budget)}>${fmtM(budget)}</td><td${cls(actual)}>${fmtM(actual)}</td>` +
      `<td${diffCls(diff)}>${diff >= 0 ? "+" : ""}${fmtM(diff)}</td>` +
      `<td class="badge-cell">${rateBadgeCell(rateOf(actual, budget))}</td>`
    );
  }
  /** 총합계/그룹B/그룹C를 각각 4칸씩 나란히 배치하는 표 (구분별 상세, EVCS 구분별 상세에서 재사용). */
  function parallelTable(
    firstColLabel: string,
    groupLabels: [string, string, string],
    rows: { label: string; total: { actual: number; budget: number }; b: { actual: number; budget: number }; c: { actual: number; budget: number } }[],
    totalRowLabel: string
  ): string {
    const body = rows
      .map((r) => `<tr><td>${r.label}</td>${quadCells(r.total.actual, r.total.budget)}${quadCells(r.b.actual, r.b.budget)}${quadCells(r.c.actual, r.c.budget)}</tr>`)
      .join("");
    const sum = (pick: (r: (typeof rows)[number]) => { actual: number; budget: number }) => ({
      actual: rows.reduce((s, r) => s + pick(r).actual, 0),
      budget: rows.reduce((s, r) => s + pick(r).budget, 0),
    });
    const totTotal = sum((r) => r.total),
      totB = sum((r) => r.b),
      totC = sum((r) => r.c);
    const totRow = `<tr class="tot"><td>${totalRowLabel}</td>${quadCells(totTotal.actual, totTotal.budget)}${quadCells(totB.actual, totB.budget)}${quadCells(totC.actual, totC.budget)}</tr>`;
    return `<table class="pl-tbl parallel-tbl"><thead>
      <tr><th rowspan="2">${firstColLabel}</th><th colspan="4" class="grp-total">${groupLabels[0]}</th><th colspan="4" class="grp-hq">${groupLabels[1]}</th><th colspan="4" class="grp-corp">${groupLabels[2]}</th></tr>
      <tr><th>예산</th><th>실적</th><th>차이</th><th>집행률</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th></tr>
    </thead><tbody>${body}${totRow}</tbody></table>`;
  }

  /** 차이 금액이 유의미할 때만, 원인이 되는 구분(부서) 1~2개를 "구분 +차이금액"으로 뽑는다. */
  function mainAccountRemark(r: MainAccountRow): string {
    return attributionRemark(r.byDept.map((d) => ({ label: stripDeptNumber(d.dept), actual: d.actual, budget: d.budget })), r.actual, r.budget);
  }
  /** 대계정별 상세 표 (구분 컬럼 + 비고). 계정별 탭과 EVCS 탭이 공유한다. */
  function mainAccountTable(rows: MainAccountRow[]): string {
    const bodyRows = rows
      .map((r) => {
        const diff = r.actual - r.budget;
        return `<tr><td>${r.category}</td><td>${r.accountLabel}</td>
          <td${cls(r.budget)}>${fmtM(r.budget)}</td><td${cls(r.actual)}>${fmtM(r.actual)}</td>
          <td${diffCls(diff)}>${diff >= 0 ? "+" : ""}${fmtM(diff)}</td>
          <td class="badge-cell">${rateBadgeCell(rateOf(r.actual, r.budget))}</td>
          <td class="remark-cell">${mainAccountRemark(r)}</td></tr>`;
      })
      .join("");
    const totA = rows.reduce((sum, r) => sum + r.actual, 0);
    const totB = rows.reduce((sum, r) => sum + r.budget, 0);
    const totDiff = totA - totB;
    const totRow = `<tr class="tot"><td colspan="2">대계정 합계</td>
      <td>${fmtM(totB)}</td><td>${fmtM(totA)}</td>
      <td${diffCls(totDiff)}>${totDiff >= 0 ? "+" : ""}${fmtM(totDiff)}</td>
      <td class="badge-cell">${rateBadgeCell(rateOf(totA, totB))}</td>
      <td></td></tr>`;
    return `<table class="pl-tbl"><thead><tr><th>구분</th><th>대계정</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th><th class="remark-th">비고</th></tr></thead><tbody>${bodyRows}${totRow}</tbody></table>`;
  }

  // ================= SUMMARY TAB =================
  function renderSummary() {
    CHART_BUILDERS["summary"] = [];
    const scope = getScope();
    const s = scope.summary;
    setText("sumTblSub", scopeLabel() + " · 백만원");

    const a = s.total.actual,
      b = s.total.budget,
      rate = rateOf(a, b);

    // 전월 대비 당월 실적 증감 (당월 보기일 때만, 비교 가능한 전월이 있을 때만 표시)
    const prevMonthIdx = months.indexOf(currentMonth) - 1;
    const summaryMomHtml =
      currentMode === "month" && prevMonthIdx >= 0
        ? momBadgeHtml(a, data.byMonth[months[prevMonthIdx]].summary.total.actual)
        : "";

    setHtml(
      "summaryKpis",
      `<div class="kcard kcard-combo"><div class="kcard-bar" style="background:#2563eb"></div>
        <div class="kcombo-item">
          <div class="klabel">집행 실적</div><div class="kval">${fmtM(a)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}${summaryMomHtml}</div>
        </div>
        <div class="kcombo-div"></div>
        <div class="kcombo-item">
          <div class="klabel">예산</div><div class="kval">${fmtM(b)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}</div>
        </div>
        <div class="kcombo-div"></div>
        <div class="kcombo-item">
          <div class="klabel">집행률</div>
          <div class="kval ${rateTextClass(rate)}">${rate === null ? "-" : rate === Infinity ? "∞" : Math.round(rate) + "%"}</div>
          <div class="ksub">${scopeLabel()} 예산 대비</div>
        </div>
      </div>`
    );

    // 경영진 요약 코멘트: 총합계 → 본사/법인 → 구분(re) → 대계정 순으로 원인을 추적한다.
    const isAlert = rate !== null && (rate === Infinity || rate > 130);
    setHtml(
      "summaryInsight",
      `<div class="callout ${isAlert ? "alert" : "info"}"><div class="ic">${isAlert ? "⚠️" : "📌"}</div><div>${drillDownSummary(scopeLabel(), s)}</div></div>`
    );

    // 신규: 월별 실적 추이 콤보 차트 (항상 전체 월 범위, 당월 기준)
    const lastMonth = months[months.length - 1];
    setText("summaryTrendSub", `1월~${lastMonth} 당월 기준, 전사`);
    queueChart("summary", "summaryTrendChart", () =>
      comboChart(
        "summaryTrendChart",
        months,
        trend.summary_total.map((x) => x.actual),
        trend.summary_total.map((x) => x.budget)
      )
    );

    // 계정과목별 구성비 도넛 (당월/누계 토글에 맞춰 표시)
    setText(
      "summaryDonutSub",
      currentMode === "month" ? `${currentMonth} 당월 실적 기준` : `1월~${currentMonth} 누계 실적 기준`
    );
    const donutCats: CategoryRow[] = scope.category;
    queueChart("summary", "summaryDonutChart", () =>
      donutChart(
        "summaryDonutChart",
        donutCats.map((c) => c.category),
        donutCats.map((c) => c.actual),
        donutCats.map((c, i) => colorFor(c.category, i))
      )
    );

    // 본사·법인 요약 표와 비교 막대는 아래 "보고용 부문별 상세"에 소계로 이미 들어 있어 제거했다.
    const deptOrder: Record<string, number> = { 본사: 0, 법인: 1 };
    const rows = [...s.rows].sort(
      (a, b) => (deptOrder[a.hq_corp] ?? 9) - (deptOrder[b.hq_corp] ?? 9) || a.dept.localeCompare(b.dept, "ko")
    );
    let html = "";
    for (const hq of ["본사", "법인"]) {
      const list = rows.filter((r) => r.hq_corp === hq);
      list.forEach((r) => {
        const remark = attributionRemark(
          r.byMainAccount.map((a) => ({ label: stripAccountNumber(a.account), actual: a.actual, budget: a.budget })),
          r.actual,
          r.budget
        );
        html += row(r.dept, r.actual, r.budget, "", hq, remark);
      });
      const subA = list.reduce((sum, r) => sum + r.actual, 0);
      const subB = list.reduce((sum, r) => sum + r.budget, 0);
      html += row(hq + " 소계", subA, subB, "tot", undefined, "");
    }
    html += row("본사+법인 합계", s.total.actual, s.total.budget, "tot", undefined, "");
    setHtml("deptTable", table5(html, "구분", "비고"));
  }

  // ================= CATEGORY TAB =================
  function renderCategory() {
    CHART_BUILDERS["category"] = [];
    const scope = getScope();
    const s = scope.summary;
    const cats = scope.category;
    const catHq = scope.categoryByHq;
    setText("catTblSub", scopeLabel() + " · 백만원");

    // 구분별 상세: 구분마다 총합계/본사/법인을 각각 예산·실적·차이·집행률 4열씩 나란히(병렬) 배치해
    // 본사와 법인을 한 행에서 바로 비교할 수 있게 한다.
    setHtml(
      "categoryTable",
      parallelTable(
        "구분",
        ["총합계", "본사", "법인"],
        cats.map((c) => ({
          label: c.category,
          total: { actual: c.actual, budget: c.budget },
          b: catHq.본사.find((x) => x.category === c.category) || { actual: 0, budget: 0 },
          c: catHq.법인.find((x) => x.category === c.category) || { actual: 0, budget: 0 },
        })),
        "전체 합계"
      )
    );
    setHtml("catLegend", legendHtml([[C_BUDGET, "예산"], [C_ACTUAL, "실적"]]));
    queueChart("category", "categoryChart", () =>
      barChart("categoryChart", cats.map((c) => c.category), cats.map((c) => c.actual), cats.map((c) => c.budget))
    );

    // 경영진 요약 코멘트: 총합계 → 본사/법인 → 구분(re) → 대계정 순으로 원인을 추적한다 (Summary 탭과 동일한 로직).
    setHtml("catInsight", `<div class="callout info"><div class="ic">💡</div><div>${drillDownSummary(scopeLabel(), s)}</div></div>`);

    // 대계정별 상세: 구분(카테고리) 컬럼을 추가하고, 구분별 상세와 같은 순서로 대계정을 묶어서 보여준다.
    setText("hqMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("hqMainAccountTable", mainAccountTable(scope.mainAccountByHq["본사"]));
    setText("corpMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("corpMainAccountTable", mainAccountTable(scope.mainAccountByHq["법인"]));

    // 조직별 지급수수료 현황 (맨 아래 배치): 본사 5개 부문(Staff부문은 대조직까지 세분화) + 법인 기준으로
    // 지급수수료 계열 4개 대계정(지급수수료/외주개발용역비/인증대행료/특허처리비) 합계를 보여준다.
    // 비고란에는 차이의 주요 원인 대계정을 표기하고, 누계 보기에서는 특정 월에 차이가 집중된 경우 그 월도 함께 짚어준다.
    setHtml("feeOrgInsight", `<div class="callout info"><div class="ic">🧾</div><div>${feeOrgSummary(scopeLabel(), scope.feeByOrg)}</div></div>`);
    const feeOrgRows = scope.feeByOrg.filter((r) => r.actual !== 0 || r.budget !== 0);
    const feeOrgRemark = (r: (typeof feeOrgRows)[number]): string => {
      const base = attributionRemark(
        r.byAccount.map((a) => ({ label: stripAccountNumber(a.account), actual: a.actual, budget: a.budget })),
        r.actual,
        r.budget
      );
      // 법인 행은 대계정뿐 아니라, 차이의 실제 원인이 되는 소속사도 함께 짚어준다.
      const companyNote = r.byCompany
        ? attributionRemark(r.byCompany.map((c) => ({ label: c.company, actual: c.actual, budget: c.budget })), r.actual, r.budget)
        : "";
      return [base, companyNote].filter(Boolean).join(", ") + feeOrgMonthNote(r.monthly, r.actual - r.budget);
    };
    const feeOrgTotalAct = feeOrgRows.filter((r) => r.level === 0).reduce((s, r) => s + r.actual, 0);
    const feeOrgTotalBud = feeOrgRows.filter((r) => r.level === 0).reduce((s, r) => s + r.budget, 0);
    setHtml(
      "feeTable",
      table5(
        feeOrgRows.map((r) => row(r.org, r.actual, r.budget, r.level === 1 ? "fee-sub" : "", undefined, feeOrgRemark(r))).join("") +
          row("합계", feeOrgTotalAct, feeOrgTotalBud, "tot", undefined, ""),
        "조직",
        "비고"
      )
    );
  }

  // ================= EVCS TAB =================
  function renderEvcs() {
    CHART_BUILDERS["evcs"] = [];
    const scope = getScope();
    const e = scope.evcs;
    setText("evcsTblSub", scopeLabel() + " · 백만원");

    const domA = e.total.domestic.actual,
      domB = e.total.domestic.budget;
    const ovsA = e.total.overseas.actual,
      ovsB = e.total.overseas.budget;
    const totA = domA + ovsA,
      totB = domB + ovsB;

    // 전월 대비 증감 (당월 보기일 때만, 비교 가능한 전월이 있을 때만 표시) - Summary 탭과 동일한 방식
    const prevEvcsMonthIdx = months.indexOf(currentMonth) - 1;
    let evcsMomTot = "";
    if (currentMode === "month" && prevEvcsMonthIdx >= 0) {
      const prevM = data.byMonth[months[prevEvcsMonthIdx]];
      const prevTotal = prevM.evcs.total.domestic.actual + prevM.evcs.total.overseas.actual;
      evcsMomTot = momBadgeHtml(totA, prevTotal);
    }
    const evcsRate = rateOf(totA, totB);

    // Humax(전사) 탭과 동일하게 실적/예산/집행률 통합 카드 하나로 표시한다.
    // 국내/해외 개별 카드는 생략하고, 대신 비중은 아래 "국내/해외 비중" 추이 차트로 확인한다.
    setHtml(
      "evcsKpis",
      `<div class="kcard kcard-combo"><div class="kcard-bar" style="background:#0891b2"></div>
        <div class="kcombo-item">
          <div class="klabel">집행 실적</div><div class="kval">${fmtM(totA)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}${evcsMomTot}</div>
        </div>
        <div class="kcombo-div"></div>
        <div class="kcombo-item">
          <div class="klabel">예산</div><div class="kval">${fmtM(totB)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}</div>
        </div>
        <div class="kcombo-div"></div>
        <div class="kcombo-item">
          <div class="klabel">집행률</div>
          <div class="kval ${rateTextClass(evcsRate)}">${evcsRate === null ? "-" : evcsRate === Infinity ? "∞" : Math.round(evcsRate) + "%"}</div>
          <div class="ksub">${scopeLabel()} 예산 대비</div>
        </div>
      </div>`
    );

    // 신규: EVCS 월별 실적 추이 콤보 차트 (국내+해외 합계, 항상 전체 월 범위)
    const lastMonth = months[months.length - 1];
    setText("evcsTrendComboSub", `1월~${lastMonth} 당월 기준, EVCS(국내+해외)`);
    const evcsTrendActual = months.map((_, i) => trend.evcs_domestic[i].actual + trend.evcs_overseas[i].actual);
    const evcsTrendBudget = months.map((_, i) => trend.evcs_domestic[i].budget + trend.evcs_overseas[i].budget);
    queueChart("evcs", "evcsTrendComboChart", () =>
      comboChart("evcsTrendComboChart", months, evcsTrendActual, evcsTrendBudget, "#0891b2")
    );

    // EVCS 계정과목별 구성비 도넛 (당월/누계 토글에 맞춰 표시, 국내+해외 합산)
    setText(
      "evcsDonutSub",
      currentMode === "month" ? `${currentMonth} 당월 실적 기준` : `1월~${currentMonth} 누계 실적 기준`
    );
    const donutEvcsCats = e.byCategory;
    queueChart("evcs", "evcsDonutChart", () =>
      donutChart(
        "evcsDonutChart",
        donutEvcsCats.map((c) => c.category),
        donutEvcsCats.map((c) => c.dom_actual + c.ovs_actual),
        donutEvcsCats.map((c, i) => colorFor(c.category, i))
      )
    );


    // 구분별 상세: 계정별 탭과 같은 병렬 배치로, EVCS 배부 금액(국내+해외) 기준 총합계/국내/해외를 나란히 보여준다.
    setHtml(
      "evcsCatTable",
      parallelTable(
        "구분",
        ["총합계", "본사", "법인"],
        e.categoryByHq.총합계.map((c, i) => ({
          label: c.category,
          total: c,
          b: e.categoryByHq.본사[i],
          c: e.categoryByHq.법인[i],
        })),
        "전체 합계"
      )
    );

    // 경영진 요약 코멘트: 총합계 → 본사/법인 → 구분(re) → 대계정 순으로 원인을 추적한다 (EVCS 배부금액 기준).
    setHtml(
      "evcsInsight",
      `<div class="callout info"><div class="ic">🔋</div><div>${drillDownSummary(scopeLabel(), e.evcsSummary)}</div></div>`
    );

    // 대계정별 상세 (EVCS 배부금액 기준) — 계정별 탭과 동일한 형태.
    setText("evcsHqMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("evcsHqMainAccountTable", mainAccountTable(e.mainAccountByHq["본사"]));
    setText("evcsCorpMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("evcsCorpMainAccountTable", mainAccountTable(e.mainAccountByHq["법인"]));

    // 인증대행료 — 상단 카드/코멘트 대신, 차트 우측에 누계 예산·실적·집행률만 간결하게 붙인다.
    const certCum = data.byMonth[currentMonth].cumulative.evcs.certAgency;
    const certCumA = certCum.domestic.actual + certCum.overseas.actual;
    const certCumB = certCum.domestic.budget + certCum.overseas.budget;
    setHtml(
      "certSide",
      `<div class="cert-metric"><div class="cert-label">누계 예산</div><div class="cert-value">${fmtM(certCumB)}<span class="kunit"> 백만원</span></div></div>` +
        `<div class="cert-metric"><div class="cert-label">누계 실적</div><div class="cert-value">${fmtM(certCumA)}<span class="kunit"> 백만원</span></div></div>` +
        `<div class="cert-metric"><div class="cert-label">누계 집행률</div><div class="cert-value">${rateBadgeCell(rateOf(certCumA, certCumB))}</div></div>` +
        `<div class="cert-note">${data.byMonth[currentMonth].cumulative.label} 기준</div>`
    );

    // 인증대행료 월별 예산·실적·집행률 콤보 차트 (국내+해외 합산, 12월까지 예산 확장 + 미경과 기간 음영)
    setText(
      "certComboSub",
      `예산 1월~12월 · 실적 1월~${months[months.length - 1]} 당월 기준, 인증대행료(국내+해외)`
    );
    const certComboBudgetFull = allMonths.map((_, i) => trend.cert_domestic_full[i].budget + trend.cert_overseas_full[i].budget);
    const certComboActualFull = allMonths.map((_, i) => {
      const d = trend.cert_domestic_full[i].actual;
      const o = trend.cert_overseas_full[i].actual;
      return d == null || o == null ? null : d + o;
    });
    queueChart("evcs", "certComboChart", () =>
      comboChart("certComboChart", allMonths, certComboActualFull, certComboBudgetFull, C_ALT, [futureShadePlugin(lastActualIdx)], null)
    );
  }

  // ================= ALLOCATION BOARD TAB =================
  // 실적 제외 등으로 모든 열이 0원인 부서/법인사 행은 표를 어지럽히기만 하므로 숨긴다
  // (본사/법인/Total 같은 구조상의 합계 행(level 0)은 0이어도 항상 유지).
  function isAllocRowEmpty(r: AllocationRow): boolean {
    return (
      r.grandTotal === 0 &&
      r.stb === 0 &&
      r.mobility === 0 &&
      r.evcsDomestic === 0 &&
      r.evcsOverseas === 0 &&
      r.humaxCommon === 0 &&
      r.building === 0 &&
      r.hMobility === 0 &&
      r.hEv === 0 &&
      r.hiparking === 0 &&
      r.peoplecar === 0 &&
      r.winercom === 0 &&
      r.holdings === 0 &&
      r.hNetworks === 0
    );
  }
  // Shared 그룹의 7개 세부 열(H.Mobility~H.Networks)은 기본적으로 화면 밖으로 밀어두고,
  // 자세히 보고 싶을 때만 표를 오른쪽으로 스크롤해서 보게 한다 (가독성을 위해 기본은 숨김에 가깝게).
  function allocTable(allRows: AllocationRow[]): string {
    const rows = allRows.filter((r) => r.level === 0 || !isAllocRowEmpty(r));
    let html =
      `<table class="pl-tbl alloc-tbl"><thead>` +
      `<tr><th rowspan="2">Company</th><th rowspan="2" class="alloc-tot-col">(A+B+C)<br>합계</th>` +
      `<th colspan="6" class="grp-a">(A) Humax</th><th rowspan="2">(B)<br>건물</th><th colspan="8" class="grp-c">(C) Shared</th></tr>` +
      `<tr><th>합계</th><th>STB</th><th>Mobility</th><th>EVCS(국내)</th><th>EVCS(해외)</th><th>Humax(공통)</th>` +
      `<th>합계</th><th>H.Mobility</th><th>H.EV</th><th>하이파킹</th><th>피플카</th><th>위너콤</th><th>홀딩스</th><th>H.Networks</th></tr>` +
      `</thead><tbody>`;
    rows.forEach((r) => {
      const rowClass = r.level === 0 ? "tot" : r.level === 1 ? "alloc-l1" : "alloc-l2";
      html +=
        `<tr class="${rowClass}"><td class="alloc-sticky">${r.label}</td><td class="alloc-tot-col">${fmtM(r.grandTotal)}</td>` +
        `<td>${fmtM(r.humaxTotal)}</td><td>${fmtM(r.stb)}</td><td>${fmtM(r.mobility)}</td><td>${fmtM(r.evcsDomestic)}</td><td>${fmtM(r.evcsOverseas)}</td><td>${fmtM(r.humaxCommon)}</td>` +
        `<td>${fmtM(r.building)}</td><td class="alloc-shared-col">${fmtM(r.sharedTotal)}</td>` +
        `<td>${fmtM(r.hMobility)}</td><td>${fmtM(r.hEv)}</td><td>${fmtM(r.hiparking)}</td><td>${fmtM(r.peoplecar)}</td><td>${fmtM(r.winercom)}</td><td>${fmtM(r.holdings)}</td><td>${fmtM(r.hNetworks)}</td></tr>`;
    });
    html += "</tbody></table>";
    return html;
  }
  function renderAlloc() {
    const scope = getScope();
    const board = scope.allocationBoard;
    setText("allocBudgetSub", scopeLabel() + " · 백만원");
    setHtml("allocBudgetTable", allocTable(board.budget));
    setText("allocActualSub", scopeLabel() + " · 백만원");
    setHtml("allocActualTable", allocTable(board.actual));
    setText("allocDiffSub", scopeLabel() + " · 백만원 · 값에 마우스를 올리면 원인 대계정이 표시됩니다");
    setHtml("allocDiffTable", allocDiffTable(board.actual, board.budget));
    setHtml(
      "allocTrendInsight",
      `<div class="callout info"><div class="ic">📈</div><div><b>${scopeLabel()} 배부 변동 요약</b> — ${allocTrendSummary(board.actual, board.budget)}</div></div>`
    );
  }

  const ALLOC_FIELDS: (keyof AllocValues13)[] = [
    "stb",
    "mobility",
    "evcsDomestic",
    "evcsOverseas",
    "humaxCommon",
    "building",
    "hMobility",
    "hEv",
    "hiparking",
    "peoplecar",
    "winercom",
    "holdings",
    "hNetworks",
  ];
  function escAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  /** 실적행/예산행의 대계정별 내역을 대계정명 -> 필드별 차이(diff)로 합쳐준다. */
  function accountDiffMap(actualRow: AllocationRow, budgetRow: AllocationRow): Map<string, AllocValues13> {
    const actualByAcc = new Map(actualRow.byAccount.map((a) => [a.account, a]));
    const budgetByAcc = new Map(budgetRow.byAccount.map((a) => [a.account, a]));
    const accounts = new Set([...actualByAcc.keys(), ...budgetByAcc.keys()]);
    const map = new Map<string, AllocValues13>();
    for (const acc of accounts) {
      const a = actualByAcc.get(acc);
      const b = budgetByAcc.get(acc);
      const diffs = {} as AllocValues13;
      for (const f of ALLOC_FIELDS) diffs[f] = (a?.[f] || 0) - (b?.[f] || 0);
      map.set(acc, diffs);
    }
    return map;
  }
  /** 특정 필드(들) 합산 기준 차이가 큰 대계정 상위 2개 + "그 외"를 "계정명 +/-N백만" 형태로 나열. */
  function diffTooltip(map: Map<string, AllocValues13>, fields: (keyof AllocValues13)[]): string {
    const entries = [...map.entries()]
      .map(([account, v]) => ({ account, diff: fields.reduce((s, f) => s + v[f], 0) }))
      .filter((e) => e.diff !== 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (!entries.length) return "";
    const top = entries.slice(0, 2);
    const parts = top.map((e) => `${e.account} ${e.diff >= 0 ? "+" : ""}${fmtM(e.diff)}백만`);
    if (entries.length > 2) {
      const rest = entries.slice(2).reduce((s, e) => s + e.diff, 0);
      parts.push(`그 외 ${rest >= 0 ? "+" : ""}${fmtM(rest)}백만`);
    }
    return parts.join(", ");
  }
  /** Diff(실적-예산) 표: 배부 현황 표와 같은 배치지만, 값에 마우스를 올리면 원인 대계정 내역이 뜬다. */
  function allocDiffTable(actualRows: AllocationRow[], budgetRows: AllocationRow[]): string {
    const budgetByLabel = new Map(budgetRows.map((b) => [b.label, b]));
    const pairs = actualRows
      .map((a) => {
        const b = budgetByLabel.get(a.label);
        return b ? { a, b } : null;
      })
      .filter((x): x is { a: AllocationRow; b: AllocationRow } => x !== null)
      .filter(({ a, b }) => a.level === 0 || !isAllocRowEmpty({ ...a, ...diffOf(a, b) } as AllocationRow));

    let html =
      `<table class="pl-tbl alloc-tbl"><thead>` +
      `<tr><th rowspan="2">Company</th><th rowspan="2" class="alloc-tot-col">(A+B+C)<br>차이</th><th rowspan="2">집행률</th>` +
      `<th colspan="6" class="grp-a">(A) Humax</th><th rowspan="2">(B)<br>건물</th><th colspan="8" class="grp-c">(C) Shared</th></tr>` +
      `<tr><th>합계</th><th>STB</th><th>Mobility</th><th>EVCS(국내)</th><th>EVCS(해외)</th><th>Humax(공통)</th>` +
      `<th>합계</th><th>H.Mobility</th><th>H.EV</th><th>하이파킹</th><th>피플카</th><th>위너콤</th><th>홀딩스</th><th>H.Networks</th></tr>` +
      `</thead><tbody>`;
    pairs.forEach(({ a, b }) => {
      const d = diffOf(a, b);
      const accMap = accountDiffMap(a, b);
      const cell = (v: number, fields: (keyof AllocValues13)[], extraClass = ""): string => {
        const tip = diffTooltip(accMap, fields);
        const signClass = v > 0 ? "neg" : v < 0 ? "pos" : "";
        const cls = [extraClass, signClass, tip ? "alloc-diff-hint" : ""].filter(Boolean).join(" ");
        return `<td class="${cls}"${tip ? ` title="${escAttr(tip)}"` : ""}>${v >= 0 ? "+" : ""}${fmtM(v)}</td>`;
      };
      const rowClass = a.level === 0 ? "tot" : a.level === 1 ? "alloc-l1" : "alloc-l2";
      const rateCell = `<td class="badge-cell">${rateBadgeCell(rateOf(a.grandTotal, b.grandTotal))}</td>`;
      html +=
        `<tr class="${rowClass}"><td class="alloc-sticky">${a.label}</td>` +
        `${cell(d.grandTotal, ALLOC_FIELDS, "alloc-tot-col")}${rateCell}` +
        `${cell(d.humaxTotal, ["stb", "mobility", "evcsDomestic", "evcsOverseas", "humaxCommon"])}` +
        `${cell(d.stb, ["stb"])}${cell(d.mobility, ["mobility"])}${cell(d.evcsDomestic, ["evcsDomestic"])}${cell(d.evcsOverseas, ["evcsOverseas"])}${cell(d.humaxCommon, ["humaxCommon"])}` +
        `${cell(d.building, ["building"])}` +
        `${cell(d.sharedTotal, ["hMobility", "hEv", "hiparking", "peoplecar", "winercom", "holdings", "hNetworks"], "alloc-shared-col")}` +
        `${cell(d.hMobility, ["hMobility"])}${cell(d.hEv, ["hEv"])}${cell(d.hiparking, ["hiparking"])}${cell(d.peoplecar, ["peoplecar"])}${cell(d.winercom, ["winercom"])}${cell(d.holdings, ["holdings"])}${cell(d.hNetworks, ["hNetworks"])}` +
        `</tr>`;
    });
    html += "</tbody></table>";
    return html;
  }
  function diffOf(a: AllocationRow, b: AllocationRow): AllocValues13 & { humaxTotal: number; sharedTotal: number; grandTotal: number } {
    const out = {} as AllocValues13 & { humaxTotal: number; sharedTotal: number; grandTotal: number };
    for (const f of ALLOC_FIELDS) out[f] = a[f] - b[f];
    out.humaxTotal = a.humaxTotal - b.humaxTotal;
    out.sharedTotal = a.sharedTotal - b.sharedTotal;
    out.grandTotal = a.grandTotal - b.grandTotal;
    return out;
  }
  /**
   * Diff 표를 실제로 훑어서 배부 항목 간 이동(예: EVCS해외→EVCS국내)이나
   * 특정 사업부 편중 초과/미달 패턴을 찾아 문장으로 만든다. 추정 없이 실제 diff 값만 사용한다.
   * level 1(부문/법인사)만 합산한다 — level 2(Staff부문 하위조직)는 그 상위 level 1 "5. Staff부문"에
   * 이미 포함된 값이라, 둘 다 더하면 Staff부문 몫이 이중으로 잡혀 Total 행과 어긋난다.
   */
  function allocTrendSummary(actualRows: AllocationRow[], budgetRows: AllocationRow[]): string {
    const budgetByLabel = new Map(budgetRows.map((b) => [b.label, b]));
    const rows = actualRows
      .filter((a) => a.level === 1)
      .map((a) => {
        const b = budgetByLabel.get(a.label);
        if (!b) return null;
        return { label: stripDeptNumber(a.label), diff: diffOf(a, b) };
      })
      .filter((x): x is { label: string; diff: AllocValues13 & { humaxTotal: number; sharedTotal: number; grandTotal: number } } => x !== null);

    const dims: { key: "stb" | "mobility" | "evcsDomestic" | "evcsOverseas" | "humaxCommon" | "sharedTotal"; label: string }[] = [
      { key: "stb", label: "STB" },
      { key: "mobility", label: "Mobility" },
      { key: "evcsDomestic", label: "EVCS(국내)" },
      { key: "evcsOverseas", label: "EVCS(해외)" },
      { key: "humaxCommon", label: "Humax(공통)" },
      { key: "sharedTotal", label: "Shared" },
    ];

    const sentences: string[] = [];
    for (const dim of dims) {
      const dimTotal = rows.reduce((s, r) => s + r.diff[dim.key], 0);
      if (Math.abs(dimTotal) < REMARK_MIN_DIFF_WON) continue; // 이 항목은 전사적으로 유의미한 변동 없음
      const sign = dimTotal > 0 ? 1 : -1;
      const top = rows
        .filter((r) => Math.sign(r.diff[dim.key]) === sign)
        .sort((a, b) => Math.abs(b.diff[dim.key]) - Math.abs(a.diff[dim.key]))[0];
      if (!top) continue;

      const over = dimTotal > 0;
      let sentence =
        `<b>${dim.label}</b>${josaEunNeun(dim.label)} 예산 대비 ${over ? "+" : ""}${fmtM(dimTotal)}백만원 ${
          over ? "초과" : "미달"
        }이며, 주요 원인은 <b>${top.label}</b>(${top.diff[dim.key] >= 0 ? "+" : ""}${fmtM(top.diff[dim.key])}백만원)${josaEunNeun(top.label)}로 파악됩니다.`;

      // 특이사항: 이 Company의 배부전 총합계는 반대 방향으로 움직였는데(=총합계는 반대로 갔는데) 이 항목의 배부액만 그렇게 늘거나 줄어든 경우만 별도로 짚어준다.
      const totalMovedOpposite = Math.sign(top.diff.grandTotal) === -sign && Math.abs(top.diff.grandTotal) >= REMARK_MIN_DIFF_WON;
      if (totalMovedOpposite) {
        sentence += ` 다만 ${top.label}의 배부전 총합계는 오히려 ${top.diff.grandTotal >= 0 ? "+" : ""}${fmtM(
          top.diff.grandTotal
        )}백만원 ${top.diff.grandTotal >= 0 ? "증가" : "감소"}해, <b>배부 비중 자체의 변동</b>${josaRoEuro(
          "배부 비중 자체의 변동"
        )} 파악되는 특이 케이스입니다.`;
      }
      sentences.push(sentence);
    }

    if (!sentences.length) {
      return "이번 기간 STB/Mobility/EVCS(국내)/EVCS(해외)/Humax(공통)/Shared 기준으로 예산 대비 유의미한 변동은 없습니다.";
    }
    return sentences.join(" ");
  }

  // ================= SUMMARY① Humax합계 / SUMMARY③ Humax합계_상세 (공용) =================
  /**
   * Summary 표용 colgroup — 첫 열(라벨)만 넓게 두고 나머지 데이터 열은 모두 같은 너비로 고정한다.
   * table-layout:fixed는 첫 행으로 열 너비를 잡는데 Summary 표는 헤더에 rowspan/colspan이 섞여 있어
   * 열 대응이 어긋난다. colgroup으로 열 너비를 직접 지정해 그 문제를 피한다.
   */
  function colgroupHtml(firstW: number, colW: number, dataCols: number): string {
    return `<colgroup><col style="width:${firstW}px">${`<col style="width:${colW}px">`.repeat(dataCols)}</colgroup>`;
  }

  /** Summary①/③의 7열(합계(A+B)/STB/MOBILITY/EVCS국내/EVCS해외/HUMAX공통/건물) 표 한 행 — STB~건물 값을 모두 채워서 보여준다. */
  type SumDetailRow = { label: string; alloc: AllocValues13 & { humaxTotal: number }; bold?: boolean; indent?: boolean };

  function sumDetailTable(rows: SumDetailRow[]): string {
    const body = rows
      .map((r) => {
        const v = r.alloc;
        const total = v.humaxTotal + v.building;
        const cls = [r.bold ? "tot" : "", r.indent ? "fee-sub" : ""].filter(Boolean).join(" ");
        return (
          `<tr class="${cls}"><td>${r.label}</td><td class="alloc-tot-col">${fmtM(total)}</td>` +
          `<td>${fmtM(v.stb)}</td><td>${fmtM(v.mobility)}</td><td>${fmtM(v.evcsDomestic)}</td><td>${fmtM(v.evcsOverseas)}</td><td>${fmtM(v.humaxCommon)}</td>` +
          `<td>${fmtM(v.building)}</td></tr>`
        );
      })
      .join("");
    // sum-tbl: 표 폭을 내용에 맞게 줄이고(width:auto) 데이터 열은 모두 같은 너비로 고정한다.
    return (
      `<table class="pl-tbl alloc-tbl sum-tbl">` +
      colgroupHtml(132, 98, 7) +
      `<thead>` +
      `<tr><th rowspan="2">Company</th><th rowspan="2" class="alloc-tot-col">(A+B)<br>합계</th><th colspan="5" class="grp-a">(A) HUMAX</th><th rowspan="2">(B)<br>건물</th></tr>` +
      `<tr><th>STB</th><th>MOBILITY</th><th>EVCS(국내)</th><th>EVCS(해외)</th><th>HUMAX(공통)</th></tr>` +
      `</thead><tbody>${body}</tbody></table>`
    );
  }

  /** AllocationBoard에서 본사/법인/Total 행을 찾아 [본사, 법인, 합계(맨 아래)] 3행 표를 만든다. */
  function allocTotalTable(board: AllocationRow[]): string {
    const hq = board.find((r) => r.label === "본사(HKR)");
    const corp = board.find((r) => r.label === "법인" && r.level === 0);
    const total = board.find((r) => r.label === "Total");
    if (!hq || !corp || !total) return "";
    return sumDetailTable([
      { label: "본사", alloc: hq },
      { label: "법인", alloc: corp },
      { label: "합계", alloc: total, bold: true },
    ]);
  }

  /** AllocationBoard(법인 파트)에서 "법인" 합계 행과 "Total" 행 사이의 법인 소속사(level 1) 행들만 추린다. */
  function corpCompanyRows(board: AllocationRow[]): AllocationRow[] {
    const corpIdx = board.findIndex((r) => r.label === "법인" && r.level === 0);
    const totalIdx = board.findIndex((r) => r.label === "Total");
    if (corpIdx < 0 || totalIdx < 0) return [];
    return board.slice(corpIdx + 1, totalIdx).filter((r) => r.level === 1);
  }

  const ALLOC_DONUT_LABELS = ["STB", "MOBILITY", "EVCS(국내)", "EVCS(해외)", "HUMAX(공통)", "건물"];
  function allocDonutValues(board: AllocationRow[]): number[] {
    const t = board.find((r) => r.label === "Total");
    if (!t) return [0, 0, 0, 0, 0, 0];
    return [t.stb, t.mobility, t.evcsDomestic, t.evcsOverseas, t.humaxCommon, t.building];
  }

  function renderSumTotal() {
    const m = data.byMonth[currentMonth];
    const cum = m.cumulative;
    setText("sumTotalMonthSub", currentMonth + " · 백만원");
    setText("sumTotalCumSub", cum.label + " · 백만원");
    setHtml("sumTotalMonthTable", allocTotalTable(m.allocationBoard.actual));
    setHtml("sumTotalCumTable", allocTotalTable(cum.allocationBoard.actual));

    // 표의 합계 행을 배부 항목별 구성비 도넛으로 시각화 (비중은 조각 위, 금액은 우측 범례).
    const monthVals = allocDonutValues(m.allocationBoard.actual);
    const cumVals = allocDonutValues(cum.allocationBoard.actual);
    setHtml("sumTotalMonthDonutLegend", donutLegendHtml(ALLOC_DONUT_LABELS));
    setHtml("sumTotalCumDonutLegend", donutLegendHtml(ALLOC_DONUT_LABELS));
    queueChart("sum-total", "sumTotalMonthDonut", () => allocDonut("sumTotalMonthDonut", ALLOC_DONUT_LABELS, monthVals));
    queueChart("sum-total", "sumTotalCumDonut", () => allocDonut("sumTotalCumDonut", ALLOC_DONUT_LABELS, cumVals));
  }

  /** 비중이 작아 개별로 볼 필요가 없는 법인 — '기타' 한 행으로 묶고, 어떤 법인인지는 표 아래 각주로 밝힌다. */
  const MINOR_CORPS = ["HTR", "HDG", "HAU"];
  const MINOR_CORP_LABEL = "기타";
  function mergeAllocRows(rows: AllocationRow[]): AllocValues13 & { humaxTotal: number } {
    const merged: AllocValues13 & { humaxTotal: number } = {
      stb: 0, mobility: 0, evcsDomestic: 0, evcsOverseas: 0, humaxCommon: 0, building: 0,
      hMobility: 0, hEv: 0, hiparking: 0, peoplecar: 0, winercom: 0, holdings: 0, hNetworks: 0,
      humaxTotal: 0,
    };
    for (const f of ALLOC_FIELDS) merged[f] = rows.reduce((s, r) => s + r[f], 0);
    merged.humaxTotal = rows.reduce((s, r) => s + r.humaxTotal, 0);
    return merged;
  }
  /** 표시 기준 금액 = (A) Humax 배부 + (B) 건물. */
  const allocAmount = (v: AllocValues13 & { humaxTotal: number }) => v.humaxTotal + v.building;

  /** Summary③의 법인 행 목록 (소액 법인은 한 행으로 병합) — 표와 전월 대비 분석이 같은 기준을 쓰도록 공용화. */
  function corpDetailRowsOf(board: AllocationRow[]): SumDetailRow[] {
    const corpRows = corpCompanyRows(board);
    const minor = corpRows.filter((r) => MINOR_CORPS.includes(r.label));
    const out: SumDetailRow[] = corpRows
      .filter((r) => !MINOR_CORPS.includes(r.label))
      .map((r) => ({ label: r.label, alloc: r, indent: true }));
    if (minor.length) out.push({ label: MINOR_CORP_LABEL, alloc: mergeAllocRows(minor), indent: true });
    return out;
  }

  /**
   * 전월 대비 급증/급감 행을 찾아낸다 — 비용을 줄이려는 관점에서 "확인이 필요한 행"만 골라 Summary에 싣는다.
   * 당월/누계 보기와 무관하게 항상 당월 vs 전월 당월로 비교하고, 금액·비율이 모두 유의미한 경우만 남긴다.
   */
  const MOM_MIN_PCT = 30;
  function momAlertsHtml(): string {
    const idx = months.indexOf(currentMonth);
    if (idx < 1) return "";
    const cur = data.byMonth[currentMonth];
    const prev = data.byMonth[months[idx - 1]];

    const collect = (m: MonthBlockLike) => {
      const map = new Map<string, number>();
      for (const c of m.hqCategoryAlloc) map.set(`본사 ${c.category}`, allocAmount(c));
      for (const r of corpDetailRowsOf(m.allocationBoard.actual)) map.set(`법인 ${r.label}`, allocAmount(r.alloc));
      return map;
    };
    const curMap = collect(cur);
    const prevMap = collect(prev);

    const alerts = [...curMap.entries()]
      .map(([label, now]) => {
        const before = prevMap.get(label) || 0;
        const diff = now - before;
        const pct = before ? (diff / before) * 100 : now ? Infinity : 0;
        return { label, diff, pct };
      })
      .filter((a) => Math.abs(a.diff) >= REMARK_MIN_DIFF_WON && (a.pct === Infinity || Math.abs(a.pct) >= MOM_MIN_PCT))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 4);

    if (!alerts.length) {
      return `<li><span class="summary-comment-dot" style="background:#94a3b8"></span>전월 대비 급격히 증감한 항목은 없습니다.</li>`;
    }
    return alerts
      .map((a) => {
        const up = a.diff > 0;
        const pctText = a.pct === Infinity ? "신규 발생" : `${up ? "+" : ""}${Math.round(a.pct)}%`;
        return (
          `<li><span class="summary-comment-dot" style="background:${up ? "#dc2626" : "#2563eb"}"></span>` +
          `<span><b>${a.label}</b> 전월 대비 <b class="${up ? "neg" : "pos"}">${up ? "+" : ""}${fmtM(a.diff)}백만원(${pctText})</b> ${up ? "급증" : "감소"}</span></li>`
        );
      })
      .join("");
  }
  type MonthBlockLike = { hqCategoryAlloc: DashboardData["byMonth"][string]["hqCategoryAlloc"]; allocationBoard: AllocationBoardLike };
  type AllocationBoardLike = { actual: AllocationRow[] };

  function renderSumDetail() {
    const scope = getScope();
    const board = scope.allocationBoard.actual;
    const total = board.find((r) => r.label === "Total");
    const hq = board.find((r) => r.label === "본사(HKR)");
    const corp = board.find((r) => r.label === "법인" && r.level === 0);
    if (!total || !hq || !corp) return;
    setText("sumDetailSub", scopeLabel() + " · 백만원");

    // 본사 구분별(인건비~기타) STB~건물 배부 내역 — 더 이상 "합계" 한 칸만이 아니라 전체 열을 채운다.
    const hqCatRows: SumDetailRow[] = scope.hqCategoryAlloc.map((c) => ({ label: c.category, alloc: c, indent: true }));

    // 본사+법인 합계는 가장 하단에 배치한다.
    setHtml(
      "sumDetailTable",
      sumDetailTable([
        { label: "본사", alloc: hq, bold: true },
        ...hqCatRows,
        { label: "법인", alloc: corp, bold: true },
        ...corpDetailRowsOf(board),
        { label: "합계", alloc: total, bold: true },
      ])
    );

    // '기타'로 묶은 법인이 무엇인지 표 아래 각주로 밝힌다.
    const hasMinor = corpCompanyRows(board).some((r) => MINOR_CORPS.includes(r.label));
    // 본사 구분에도 '기타'가 있으므로 "법인의 기타"로 명확히 적는다.
    setText("sumDetailNote", hasMinor ? `* 법인의 ${MINOR_CORP_LABEL} = ${MINOR_CORPS.join(", ")} (비중이 작아 합산 표기)` : "");

    // 전월 대비 급증/급감 행은 Summary 박스 하단에 자동으로 덧붙인다 (매월 값이 달라지므로 고정 문구로 둘 수 없다).
    const momIdx = months.indexOf(currentMonth);
    setText("sumDetailMomTitle", momIdx >= 1 ? `전월(${months[momIdx - 1]}) 대비 확인 필요` : "");
    setHtml("sumDetailMomList", momAlertsHtml());
  }

  // ================= SUMMARY② EVCS사업부 =================
  // EVCS는 주력사업이라 현 시점 예산의 정확도가 낮아, 이 시트에서는 예산 대비 비교(차이/집행률)를 쓰지 않는다.
  // 예산은 "연간 예산 대비 누계 집행률" 한 컬럼에만 남겨 진척도만 확인한다.
  const evcsAnnual = data.evcsAnnualBudget;
  /** 누계 실적 / 연간 예산 = 연간 대비 누계 집행률. */
  function annualRateCell(cumActual: number, annualBudget: number): string {
    return `<td class="badge-cell">${rateBadgeCell(rateOf(cumActual, annualBudget))}</td>`;
  }

  /**
   * 국내·해외 배부 현황.
   * 열은 기간 흐름(당월 → 당월 누계 → 연간 예산 → 집행률)으로만 두고, 본사/법인 × 국내/해외는 행 계층으로 내렸다.
   * 이렇게 하면 같은 행 안에서 "누계 ÷ 연간 예산 = 집행률"이 바로 검산된다
   * (이전 표는 금액이 당월인데 집행률만 누계라 계산이 맞지 않아 보였다).
   */
  function evcsSplitTableBody(monthE: EvcsBlock, cumE: EvcsBlock): string {
    const cell = (v: number) => `<td>${fmtM(v)}</td>`;
    const line = (label: string, m: number, c: number, a: number, cls = "") =>
      `<tr class="${cls}"><td>${label}</td>${cell(m)}<td class="col-sum">${fmtM(c)}</td>${cell(a)}${annualRateCell(c, a)}</tr>`;

    // 소계를 그룹 머리행으로 올리고 국내/해외를 그 아래 하위 행으로 둔다 (별도 머리행 없이 계층 표현).
    // 값이 전부 0인 하위 행(예: 법인의 국내 배부)은 읽는 사람에게 의미가 없어 생략한다.
    const hqBlock = (hq: "본사" | "법인") => {
      const m = monthE.byHq[hq];
      const c = cumE.byHq[hq];
      const a = evcsAnnual[hq];
      const subs = [
        { label: "국내", mv: m.domestic.actual, cv: c.domestic.actual, av: a.domestic },
        { label: "해외", mv: m.overseas.actual, cv: c.overseas.actual, av: a.overseas },
      ].filter((s) => s.mv !== 0 || s.cv !== 0 || s.av !== 0);
      const parent = line(hq, m.domestic.actual + m.overseas.actual, c.domestic.actual + c.overseas.actual, a.total, "subtot");
      // 남은 하위 행이 하나뿐이면 그 값이 그룹 행과 똑같아 중복이므로 하위 행을 생략한다 (예: 국내 배부가 없는 법인).
      if (subs.length < 2) return parent;
      return parent + subs.map((s) => line(s.label, s.mv, s.cv, s.av, "fee-sub")).join("");
    };

    const totalRow = line(
      "전사 합계",
      monthE.total.domestic.actual + monthE.total.overseas.actual,
      cumE.total.domestic.actual + cumE.total.overseas.actual,
      evcsAnnual.본사.total + evcsAnnual.법인.total,
      "tot"
    );

    return (
      `<table class="pl-tbl sum-tbl">` +
      colgroupHtml(126, 96, 4) +
      `<thead><tr><th>구분</th><th>${currentMonth} 실적</th><th class="col-sum">누계 실적</th>` +
      `<th>연간 예산</th><th>누계 집행률</th></tr></thead>` +
      `<tbody>${hqBlock("본사")}${hqBlock("법인")}${totalRow}</tbody></table>`
    );
  }

  /** 구분별 금액 규모 도넛 — 누계 실적 기준, 본사/법인 각각 (Summary①의 도넛과 동일한 형태). */
  function renderEvcsCatDonut(hq: "본사" | "법인", key: "Hq" | "Corp") {
    const rows = data.byMonth[currentMonth].cumulative.evcs.categoryByHq[hq];
    const labels = rows.map((r) => r.category);
    const values = rows.map((r) => r.actual);
    setHtml(`evcsDonut${key}Legend`, donutLegendHtml(labels, values));
    queueChart("sum-evcs", `evcsDonut${key}`, () => allocDonut(`evcsDonut${key}`, labels, values));
  }

  /**
   * 국내/해외 월별 실적 추이 — 국내 철수 예정이라 "국내가 실제로 줄고 있는지", 해외가 늘고 있는지를 본다.
   * 예산선은 그리지 않는다 (이 시트는 실적 추이만 본다).
   */
  function evcsTrendChart(): AnyChart {
    const dom = trend.evcs_domestic.map((x) => x.actual);
    const ovs = trend.evcs_overseas.map((x) => x.actual);
    const tot = months.map((_, i) => dom[i] + ovs[i]);
    // 합계선은 항상 국내·해외 위에 놓이므로 가장 진한 색·굵은 선으로 두어 EVCS 전체 규모를 먼저 읽게 한다.
    return lineChartMulti("evcsTrendChart", months, [
      { label: "합계", data: tot, borderColor: "#0f172a", backgroundColor: "#0f172a", tension: 0.3, pointRadius: 3, borderWidth: 2.5 },
      { label: "국내", data: dom, borderColor: "#1d4ed8", backgroundColor: "#1d4ed8", tension: 0.3, pointRadius: 3, borderWidth: 2 },
      { label: "해외", data: ovs, borderColor: "#94a3b8", backgroundColor: "#94a3b8", tension: 0.3, pointRadius: 3, borderWidth: 2 },
    ]);
  }

  /** 합계·국내·해외 추이를 문장 한 줄로 요약 — 첫 달 대비 최근 달 증감. */
  function evcsTrendNote(): string {
    if (months.length < 2) return "";
    const dom = trend.evcs_domestic.map((x) => x.actual);
    const ovs = trend.evcs_overseas.map((x) => x.actual);
    const tot = months.map((_, i) => dom[i] + ovs[i]);
    const last = months.length - 1;
    const pct = (arr: number[]) => (arr[0] ? Math.round(((arr[last] - arr[0]) / arr[0]) * 100) : 0);
    const word = (p: number) => (p > 0 ? `+${p}% 증가` : p < 0 ? `${p}% 감소` : "보합");
    return `${months[0]} 대비 ${months[last]} 기준 합계 ${word(pct(tot))}, 국내 ${word(pct(dom))}, 해외 ${word(pct(ovs))}`;
  }

  function renderSumEvcs() {
    const monthE = data.byMonth[currentMonth].evcs;
    const cumE = data.byMonth[currentMonth].cumulative.evcs;

    setText("evcsSplitSub", `EVCS 배부금액 · 백만원 · 누계 집행률 = 누계 실적 ÷ 연간 예산`);
    setHtml("evcsSplitTable", evcsSplitTableBody(monthE, cumE));

    // 구분별 금액 규모 — 누계 실적 기준 구성비 도넛, 본사/법인 각각.
    setText("sumEvcsSub", `${data.byMonth[currentMonth].cumulative.label} 실적 기준 · 백만원`);
    renderEvcsCatDonut("본사", "Hq");
    renderEvcsCatDonut("법인", "Corp");

    setText("evcsTrendSub", `${months[0]}~${months[months.length - 1]} 실적 · 백만원 — ${evcsTrendNote()}`);
    queueChart("sum-evcs", "evcsTrendChart", evcsTrendChart);
  }

  function renderAll() {
    setText("topbarMeta", `단위: 백만원 · 기준월: ${currentMonth} · 보기: ${currentMode === "month" ? "당월" : "누계(YTD)"}`);
    renderSumTotal();
    renderSumEvcs();
    renderSumDetail();
    renderSummary();
    renderCategory();
    renderEvcs();
    renderAlloc();
  }

  // ============ init controls ============
  const monthSelect = el("monthSelect") as HTMLSelectElement | null;
  if (monthSelect) {
    monthSelect.innerHTML = "";
    months.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === currentMonth) opt.selected = true;
      monthSelect.appendChild(opt);
    });
  }
  function onMonthChange(ev: Event) {
    currentMonth = (ev.target as HTMLSelectElement).value;
    renderAll();
  }
  monthSelect?.addEventListener("change", onMonthChange);

  function onModeToggleClick(ev: Event) {
    const btn = (ev.target as HTMLElement).closest(".seg-btn") as HTMLElement | null;
    if (!btn) return;
    document.querySelectorAll("#modeToggle .seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode as "month" | "cum";
    renderAll();
  }
  const modeToggle = el("modeToggle");
  modeToggle?.addEventListener("click", onModeToggleClick);

  renderAll();

  return () => {
    monthSelect?.removeEventListener("change", onMonthChange);
    modeToggle?.removeEventListener("click", onModeToggleClick);
    tabEls.forEach((t) => t.removeEventListener("click", onTabClick));
    Object.keys(charts).forEach(destroyChart);
  };
}
