"use client";

import { Chart, registerables } from "chart.js";
import type { DashboardData, CategoryRow, FeeRow, MainAccountRow, AllocationRow, AllocValues13, SummaryBlock } from "./types";

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
  /** 비고에 "유의미한 차이"로 볼 최소 금액. 본사/법인 모두 동일 기준 적용. */
  const REMARK_MIN_DIFF_WON = 30_000_000;
  /**
   * "비고"란에 표시할, 차이를 만든 원인 항목 1~2개를 찾는다.
   * 차이 금액이 REMARK_MIN_DIFF_WON(3천만원) 이상일 때만 "유의미"로 보고 채운다.
   * 원인 후보(byLabel)는 상위 항목과 같은 방향(초과/미달)으로 기여한 것 중 금액이 큰 순으로 최대 2개.
   * 초과(+)는 빨강, 미달(-)은 초록으로 통일해서 표기한다.
   */
  function attributionRemark(byLabel: { label: string; actual: number; budget: number }[], actual: number, budget: number): string {
    const diff = actual - budget;
    if (diff === 0 || Math.abs(diff) < REMARK_MIN_DIFF_WON) return "";
    const sign = diff > 0 ? 1 : -1;
    const contributors = byLabel
      .map((b) => ({ label: b.label, diff: b.actual - b.budget }))
      .filter((b) => Math.sign(b.diff) === sign)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 2);
    if (!contributors.length) return "";
    return contributors
      .map((c) => `<span class="${c.diff >= 0 ? "neg" : "pos"}">${c.label} ${c.diff >= 0 ? "+" : ""}${fmtM(c.diff)}백만원</span>`)
      .join(", ");
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
        : `<b>${h.hq}</b>${josaEunNeun(h.hq)} ${parts.join(", ")} 집행 미달로 예산 대비 <b>${fmtM(h.diff)}백만원</b> 절감되었습니다.`;
    });

    return `<b>${scopeLabel} 전사 실적</b> — ${overallText}. ${sentences.join(" ")}`;
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

  function onTabClick(ev: Event) {
    const target = ev.currentTarget as HTMLElement;
    const id = target.dataset.tab!;
    document.querySelectorAll(".content").forEach((c) => c.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    el("tab-" + id)?.classList.add("active");
    target.classList.add("active");
    requestAnimationFrame(() => {
      (CHART_BUILDERS[id] || []).forEach((fn) => fn());
      CHART_BUILDERS[id] = [];
    });
  }
  const tabEls = Array.from(document.querySelectorAll<HTMLElement>(".tab"));
  tabEls.forEach((t) => t.addEventListener("click", onTabClick));

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
    extraPlugins: any[] = []
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

  // ============ KPI card ============
  function kcard(color: string, label: string, actual: number, budget: number, momHtml = ""): string {
    const diff = actual - budget;
    const rate = rateOf(actual, budget);
    return `<div class="kcard"><div class="kcard-bar" style="background:${color}"></div>
      <div class="klabel">${label}</div>
      <div class="kval">${fmtM(actual)}<span class="kunit"> 백만원</span></div>
      <div class="ksub">예산 ${fmtM(budget)} 백만원 · 차이 ${diff >= 0 ? "+" : ""}${fmtM(diff)}${momHtml}</div>
      <span class="kbadge ${badgeClass(rate)}">집행률 ${badgeLabel(rate)}</span></div>`;
  }

  const CHIP_CLASS: Record<string, string> = { 본사: "hq", 법인: "corp", 국내: "dom", 해외: "ovs" };
  function row(label: string, actual: number, budget: number, rowClass = "", hqChip?: string, remark?: string): string {
    const diff = actual - budget;
    const rate = rateOf(actual, budget);
    const nameCell = hqChip ? `<span class="hq-chip ${CHIP_CLASS[hqChip] || "corp"}">${hqChip}</span>${label}` : label;
    const remarkCell = remark === undefined ? "" : `<td class="remark-cell">${remark}</td>`;
    return `<tr class="${rowClass}"><td>${nameCell}</td>
      <td${cls(budget)}>${fmtM(budget)}</td><td${cls(actual)}>${fmtM(actual)}</td>
      <td${diffCls(diff)}>${diff >= 0 ? "+" : ""}${fmtM(diff)}</td>
      <td class="badge-cell">${rateBadgeCell(rate)}</td>${remarkCell}</tr>`;
  }
  function table5(rowsHtml: string, firstColLabel = "구분", extraColLabel?: string): string {
    const extraTh = extraColLabel === undefined ? "" : `<th>${extraColLabel}</th>`;
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
    return `<table class="pl-tbl"><thead><tr><th>구분</th><th>대계정</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th><th>비고</th></tr></thead><tbody>${bodyRows}${totRow}</tbody></table>`;
  }

  // ================= SUMMARY TAB =================
  function renderSummary() {
    CHART_BUILDERS["summary"] = [];
    const scope = getScope();
    const s = scope.summary;
    setText("sumTblSub", scopeLabel() + " · 백만원");

    const a = s.total.actual,
      b = s.total.budget,
      diff = a - b,
      rate = rateOf(a, b);

    // 전월 대비 당월 실적 증감 (당월 보기일 때만, 비교 가능한 전월이 있을 때만 표시)
    const prevMonthIdx = months.indexOf(currentMonth) - 1;
    const summaryMomHtml =
      currentMode === "month" && prevMonthIdx >= 0
        ? momBadgeHtml(a, data.byMonth[months[prevMonthIdx]].summary.total.actual)
        : "";

    setHtml(
      "summaryKpis",
      `<div class="kcard"><div class="kcard-bar" style="background:#2563eb"></div>
          <div class="klabel">집행 실적</div><div class="kval">${fmtM(a)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}${summaryMomHtml}</div></div>` +
        `<div class="kcard"><div class="kcard-bar" style="background:#94a3b8"></div>
          <div class="klabel">예산</div><div class="kval">${fmtM(b)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">${scopeLabel()}</div></div>` +
        `<div class="kcard"><div class="kcard-bar" style="background:${diff > 0 ? "#dc2626" : "#2563eb"}"></div>
          <div class="klabel">차이 금액 (실적-예산)</div>
          <div class="kval" style="color:${diff > 0 ? "#dc2626" : "#2563eb"}">${diff >= 0 ? "+" : ""}${fmtM(diff)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">&nbsp;</div></div>` +
        `<div class="kcard"><div class="kcard-bar" style="background:#7c3aed"></div>
          <div class="klabel">집행률</div><div class="kval">${rate === null ? "-" : rate === Infinity ? "∞" : Math.round(rate) + "%"}</div>
          <span class="kbadge ${badgeClass(rate)}">${badgeLabel(rate)}</span></div>`
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

    setHtml(
      "hqSummaryTable",
      table5(
        row("본사", s.hq_totals["본사"].actual, s.hq_totals["본사"].budget, "", "본사") +
          row("법인", s.hq_totals["법인"].actual, s.hq_totals["법인"].budget, "", "법인") +
          row("본사+법인 합계", s.total.actual, s.total.budget, "tot")
      )
    );
    setHtml("hqLegend", legendHtml([[C_BUDGET, "예산"], [C_ACTUAL, "실적"]]));
    queueChart("summary", "hqChart", () =>
      barChart(
        "hqChart",
        ["본사", "법인"],
        [s.hq_totals["본사"].actual, s.hq_totals["법인"].actual],
        [s.hq_totals["본사"].budget, s.hq_totals["법인"].budget]
      )
    );

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
    const fees = scope.fee;
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

    // 지급수수료 상세 관리 (맨 아래 배치): 비고란에 차이의 주요 원인이 되는 구분(re) 표기
    const feeRemark = (f: FeeRow): string =>
      attributionRemark(f.byDept.map((d) => ({ label: stripDeptNumber(d.dept), actual: d.actual, budget: d.budget })), f.actual, f.budget);
    setHtml(
      "feeTable",
      table5(
        fees.map((f) => row(f.account, f.actual, f.budget, "", undefined, feeRemark(f))).join("") +
          row("지급수수료 합계", fees.reduce((s, f) => s + f.actual, 0), fees.reduce((s, f) => s + f.budget, 0), "tot", undefined, ""),
        "구분",
        "비고"
      )
    );
    const cert = fees.find((f) => f.account.includes("인증대행료"));
    if (cert) {
      const certRate = rateOf(cert.actual, cert.budget);
      if (certRate !== null && (certRate > 130 || certRate === Infinity)) {
        setHtml(
          "feeInsight",
          `<div class="callout alert"><div class="ic">⚠️</div>
            <div><b>인증대행료 집행률 ${badgeLabel(certRate)}</b> — 예산(${fmtM(cert.budget)}백만원) 대비 실적(${fmtM(cert.actual)}백만원)이 크게 초과되었습니다. 원인 확인이 필요합니다.</div></div>`
        );
      } else {
        setHtml(
          "feeInsight",
          `<div class="callout info"><div class="ic">✅</div><div><b>인증대행료</b> 집행률 ${badgeLabel(certRate)} — 예산 대비 안정적으로 관리되고 있습니다.</div></div>`
        );
      }
    }
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
    let evcsMomTot = "",
      evcsMomDom = "",
      evcsMomOvs = "";
    if (currentMode === "month" && prevEvcsMonthIdx >= 0) {
      const prevM = data.byMonth[months[prevEvcsMonthIdx]];
      const prevDom = prevM.evcs.total.domestic.actual;
      const prevOvs = prevM.evcs.total.overseas.actual;
      evcsMomTot = momBadgeHtml(totA, prevDom + prevOvs);
      evcsMomDom = momBadgeHtml(domA, prevDom);
      evcsMomOvs = momBadgeHtml(ovsA, prevOvs);
    }

    setHtml(
      "evcsKpis",
      kcard("#2563eb", "EVCS 전체 실적", totA, totB, evcsMomTot) +
        kcard("#0891b2", "국내", domA, domB, evcsMomDom) +
        kcard("#0f172a", "해외", ovsA, ovsB, evcsMomOvs) +
        `<div class="kcard"><div class="kcard-bar" style="background:#7c3aed"></div>
          <div class="klabel">해외 비중</div><div class="kval">${Math.round((ovsA / (totA || 1)) * 100)}<span class="kunit">%</span></div>
          <div class="ksub">${scopeLabel()} 기준</div></div>`
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

    const cd = e.certAgency.domestic,
      co = e.certAgency.overseas;
    const cdRate = rateOf(cd.actual, cd.budget),
      coRate = rateOf(co.actual, co.budget);
    const certTotA = cd.actual + co.actual,
      certTotB = cd.budget + co.budget;

    const riskyDom = cdRate !== null && (cdRate === Infinity || cdRate > 130);
    const riskyOvs = coRate !== null && (coRate === Infinity || coRate > 130);
    if (riskyDom || riskyOvs) {
      const parts: string[] = [];
      if (riskyDom) parts.push(`국내 ${badgeLabel(cdRate)}`);
      if (riskyOvs) parts.push(`해외 ${badgeLabel(coRate)}`);
      setHtml(
        "certAlert",
        `<div class="callout alert"><div class="ic">⚠️</div>
          <div><b>인증대행료 초과 집행 위험</b> — ${scopeLabel()} 기준 ${parts.join(", ")}로 예산을 크게 초과했습니다. 잔여 예산 및 연간 계획 재검토가 필요합니다.</div></div>`
      );
    } else {
      setHtml(
        "certAlert",
        `<div class="callout info"><div class="ic">✅</div><div>${scopeLabel()} 기준 인증대행료는 예산 범위 내에서 관리되고 있습니다 (합계 집행률 ${badgeLabel(rateOf(certTotA, certTotB))}).</div></div>`
      );
    }

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
      comboChart("certComboChart", allMonths, certComboActualFull, certComboBudgetFull, C_ALT, [futureShadePlugin(lastActualIdx)])
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
  function allocTable(allRows: AllocationRow[], opts: { showRate?: boolean; budgetRows?: AllocationRow[] }): string {
    const rows = allRows.filter((r) => r.level === 0 || !isAllocRowEmpty(r));
    const budgetByLabel = new Map((opts.budgetRows || []).map((b) => [b.label, b]));
    const rateHeader = opts.showRate ? "<th rowspan=\"2\">집행률</th>" : "";
    let html =
      `<table class="pl-tbl alloc-tbl"><thead>` +
      `<tr><th rowspan="2">Company</th><th rowspan="2" class="alloc-tot-col">(A+B+C)<br>합계</th>${rateHeader}` +
      `<th colspan="6" class="grp-a">(A) Humax</th><th rowspan="2">(B)<br>건물</th><th colspan="8" class="grp-c">(C) Shared</th></tr>` +
      `<tr><th>합계</th><th>STB</th><th>Mobility</th><th>EVCS(국내)</th><th>EVCS(해외)</th><th>Humax(공통)</th>` +
      `<th>합계</th><th>H.Mobility</th><th>H.EV</th><th>하이파킹</th><th>피플카</th><th>위너콤</th><th>홀딩스</th><th>H.Networks</th></tr>` +
      `</thead><tbody>`;
    rows.forEach((r) => {
      const rowClass = r.level === 0 ? "tot" : r.level === 1 ? "alloc-l1" : "alloc-l2";
      let rateCell = "";
      if (opts.showRate) {
        const b = budgetByLabel.get(r.label);
        rateCell = `<td class="badge-cell">${rateBadgeCell(b ? rateOf(r.grandTotal, b.grandTotal) : null)}</td>`;
      }
      html +=
        `<tr class="${rowClass}"><td class="alloc-sticky">${r.label}</td><td class="alloc-tot-col">${fmtM(r.grandTotal)}</td>${rateCell}` +
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
    setHtml("allocBudgetTable", allocTable(board.budget, {}));
    setText("allocActualSub", scopeLabel() + " · 백만원");
    setHtml("allocActualTable", allocTable(board.actual, { showRate: true, budgetRows: board.budget }));
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
      `<tr><th rowspan="2">Company</th><th rowspan="2" class="alloc-tot-col">(A+B+C)<br>차이</th>` +
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
      html +=
        `<tr class="${rowClass}"><td class="alloc-sticky">${a.label}</td>` +
        `${cell(d.grandTotal, ALLOC_FIELDS, "alloc-tot-col")}` +
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
      // 이 Company의 배부전 총합계도 같은 방향으로 유의미하게 움직였으면 "총합계 변동", 아니면 "배부 변동"(다른 항목에서 이동).
      const totalMovedSameWay = Math.sign(top.diff.grandTotal) === sign && Math.abs(top.diff.grandTotal) >= REMARK_MIN_DIFF_WON;
      const causeType = totalMovedSameWay ? "총합계 자체의 변동" : "다른 항목에서의 배부 변동";
      sentences.push(
        `<b>${dim.label}</b>${josaEunNeun(dim.label)} 예산 대비 ${over ? "+" : ""}${fmtM(dimTotal)}백만원 ${
          over ? "초과" : "미달"
        }이며, 주요 원인은 <b>${top.label}</b>(${top.diff[dim.key] >= 0 ? "+" : ""}${fmtM(top.diff[dim.key])}백만원)${josaEunNeun(
          top.label
        )}로, ${top.label}의 배부전 총합계는 ${
          totalMovedSameWay ? `${top.diff.grandTotal >= 0 ? "+" : ""}${fmtM(top.diff.grandTotal)}백만원 함께 움직여` : "예산과 큰 차이가 없어"
        } <b>${causeType}</b>${josaRoEuro(causeType)} 파악됩니다.`
      );
    }

    if (!sentences.length) {
      return "이번 기간 STB/Mobility/EVCS(국내)/EVCS(해외)/Humax(공통)/Shared 기준으로 예산 대비 유의미한 변동은 없습니다.";
    }
    return sentences.join(" ");
  }

  function renderAll() {
    setText("topbarMeta", `단위: 백만원 · 기준월: ${currentMonth} · 보기: ${currentMode === "month" ? "당월" : "누계(YTD)"}`);
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
