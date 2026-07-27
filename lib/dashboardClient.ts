"use client";

import { Chart, registerables } from "chart.js";
import type { DashboardData, CategoryRow, FeeRow, MainAccountRow } from "./types";

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
const C_ACTUAL2 = "#0f172a";
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
  function badgeClass(rate: number | null): string {
    if (rate === null) return "bd-gray";
    if (rate === Infinity) return "bd-red";
    if (rate > 130) return "bd-red";
    if (rate > 110) return "bd-yellow";
    if (rate < 70) return "bd-blue";
    return "bd-green";
  }
  function badgeLabel(rate: number | null): string {
    if (rate === null) return "해당없음";
    if (rate === Infinity) return "예산없음";
    return Math.round(rate) + "%";
  }
  function rateBadgeCell(rate: number | null): string {
    return `<span class="kbadge ${badgeClass(rate)}">${badgeLabel(rate)}</span>`;
  }
  /**
   * 집행률만 극단적이고 금액은 미미한 항목이 1순위로 뽑히지 않도록,
   * "집행률 괴리 정도"와 "차이 금액(백만원)"을 함께 곱해 중요도를 매긴다.
   * 예: 예산1/실적5(500%, 차이 4원)보다 예산10억/실적12억(120%, 차이 2억)이 더 중요한 이슈다.
   */
  function gapScore(rate: number | null, diff: number): number {
    if (rate === null) return -Infinity;
    if (rate === Infinity) return Infinity;
    return (Math.abs(diff) / 1e6) * (Math.abs(rate - 100) / 100);
  }
  type GapItem<T> = T & { rate: number | null; diff: number };
  /** 이미 rate/diff가 계산된 목록 중 gapScore가 가장 큰 항목을 찾는다(over/under를 미리 나눠 각각 호출할 때 사용). */
  function maxByGap<T extends { rate: number | null; diff: number }>(items: T[]): T | null {
    let best: T | null = null;
    for (const it of items) {
      if (it.rate === null) continue;
      if (!best || gapScore(it.rate, it.diff) > gapScore(best.rate, best.diff)) best = it;
    }
    return best;
  }
  /** 항목들 중 "집행률 괴리 × 금액 차이"가 가장 큰(=경영상 가장 중요한) 항목을 찾는다. */
  function topGap<T extends { actual: number; budget: number }>(items: T[]): GapItem<T> | null {
    let best: GapItem<T> | null = null;
    let bestScore = -Infinity;
    for (const it of items) {
      const rate = rateOf(it.actual, it.budget);
      const diff = it.actual - it.budget;
      const score = gapScore(rate, diff);
      if (score > bestScore) {
        bestScore = score;
        best = { ...it, rate, diff };
      }
    }
    return best;
  }
  /** "OO (110%, 예산 대비 +80백만원 초과)" 형태의 괴리 설명 문구. */
  function describeGap(label: string, g: { rate: number | null; diff: number }): string {
    if (g.rate === Infinity) return `${label} (예산 없이 ${fmtM(g.diff)}백만원 집행)`;
    if (g.rate === null) return label;
    const over = g.diff > 0;
    return `${label} (${badgeLabel(g.rate)}, 예산 대비 ${over ? "+" : ""}${fmtM(g.diff)}백만원 ${over ? "초과" : "미집행"})`;
  }
  /**
   * "비고"란에 표시할, 차이를 만든 원인 항목 1~2개를 찾는다.
   * 집행률 괴리가 20%p 이상이면서, 차이 금액이 기준 규모(scaleBudget) 대비 3% 이상일 때만 "유의미"로 보고 채운다.
   * 원인 후보(byLabel)는 상위 항목과 같은 방향(초과/미달)으로 기여한 것 중 금액이 큰 순으로 최대 2개.
   */
  function attributionRemark(
    byLabel: { label: string; actual: number; budget: number }[],
    actual: number,
    budget: number,
    scaleBudget: number
  ): string {
    const rate = rateOf(actual, budget);
    const diff = actual - budget;
    if (rate === null || diff === 0) return "";
    const rateOff = rate === Infinity ? Infinity : Math.abs(rate - 100);
    const scaleRatio = scaleBudget > 0 ? Math.abs(diff) / scaleBudget : 0;
    if (!(rateOff >= 20 && scaleRatio >= 0.03)) return "";
    const sign = diff > 0 ? 1 : -1;
    const contributors = byLabel
      .map((b) => ({ label: b.label, diff: b.actual - b.budget }))
      .filter((b) => Math.sign(b.diff) === sign)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 2);
    if (!contributors.length) return "";
    return contributors.map((c) => `${c.label} ${c.diff >= 0 ? "+" : ""}${fmtM(c.diff)}백만원`).join(", ");
  }
  /** 전월 대비 증감 배지 (당월 보기에서만 의미가 있음). */
  function momBadgeHtml(current: number, previous: number | null): string {
    if (!previous) return "";
    const momPct = ((current - previous) / previous) * 100;
    const up = momPct > 0;
    return ` <span style="color:${up ? "#dc2626" : "#16a34a"};font-weight:600">${up ? "▲" : "▼"} 전월대비 ${Math.abs(Math.round(momPct))}%</span>`;
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

  function row(label: string, actual: number, budget: number, rowClass = "", hqChip?: string, remark?: string): string {
    const diff = actual - budget;
    const rate = rateOf(actual, budget);
    const nameCell = hqChip ? `<span class="hq-chip ${hqChip === "본사" ? "hq" : "corp"}">${hqChip}</span>${label}` : label;
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
        `<div class="kcard"><div class="kcard-bar" style="background:${diff > 0 ? "#dc2626" : "#16a34a"}"></div>
          <div class="klabel">차이 금액 (실적-예산)</div>
          <div class="kval" style="color:${diff > 0 ? "#dc2626" : "#16a34a"}">${diff >= 0 ? "+" : ""}${fmtM(diff)}<span class="kunit"> 백만원</span></div>
          <div class="ksub">&nbsp;</div></div>` +
        `<div class="kcard"><div class="kcard-bar" style="background:#7c3aed"></div>
          <div class="klabel">집행률</div><div class="kval">${rate === null ? "-" : rate === Infinity ? "∞" : Math.round(rate) + "%"}</div>
          <span class="kbadge ${badgeClass(rate)}">${badgeLabel(rate)}</span></div>`
    );

    // 경영진 요약 코멘트: 전사 집행 상태 + "집행률 괴리가 크면서 금액도 유의미한" 부서/계정과목 한눈에 보기
    // (단순 집행률 최고/최저가 아니라, 괴리율×금액을 함께 고려 — 예산 1원짜리가 500%를 찍어도 의미 없음)
    const deptGap = topGap(s.rows.map((r) => ({ label: r.dept, actual: r.actual, budget: r.budget })));
    const catGap = topGap(scope.category.map((c) => ({ label: c.category, actual: c.actual, budget: c.budget })));
    const rateText =
      rate === null
        ? "집행 실적이 아직 없습니다"
        : rate === Infinity
        ? "예산이 없는 상태에서 집행이 발생했습니다"
        : `집행률 ${Math.round(rate)}%로 ${rate > 110 ? "예산을 초과 집행" : rate < 70 ? "예산 대비 여유 있게 집행" : "예산 범위 내에서 안정적으로 집행"}되고 있습니다`;
    const insightParts = [`<b>${scopeLabel()} 전사 실적</b> — ${rateText}.`];
    if (deptGap) insightParts.push(`예산과의 괴리가 가장 큰 부서는 <b>${describeGap(deptGap.label, deptGap)}</b>입니다.`);
    if (catGap) insightParts.push(`계정과목 중에서는 <b>${describeGap(catGap.label, catGap)}</b>의 괴리가 커 확인이 필요합니다.`);
    const isAlert = rate !== null && (rate === Infinity || rate > 130);
    setHtml(
      "summaryInsight",
      `<div class="callout ${isAlert ? "alert" : "info"}"><div class="ic">${isAlert ? "⚠️" : "📌"}</div><div>${insightParts.join(" ")}</div></div>`
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
          r.byMainAccount.map((a) => ({ label: a.account, actual: a.actual, budget: a.budget })),
          r.actual,
          r.budget,
          s.total.budget
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
    const fees = scope.fee;
    setText("catTblSub", scopeLabel() + " · 백만원");

    setHtml(
      "categoryTable",
      table5(
        cats.map((c) => row(c.category, c.actual, c.budget)).join("") +
          row("전체 합계", cats.reduce((s, c) => s + c.actual, 0), cats.reduce((s, c) => s + c.budget, 0), "tot")
      )
    );
    setHtml("catLegend", legendHtml([[C_BUDGET, "예산"], [C_ACTUAL, "실적"]]));
    queueChart("category", "categoryChart", () =>
      barChart("categoryChart", cats.map((c) => c.category), cats.map((c) => c.actual), cats.map((c) => c.budget))
    );

    // 집행률만 보지 않고 "괴리율 × 금액"이 큰 구분을 뽑는다 (금액이 미미하면 집행률이 튀어도 후순위).
    const catsWithGap = cats.map((c) => ({ ...c, rate: rateOf(c.actual, c.budget), diff: c.actual - c.budget }));
    const topOver = maxByGap(catsWithGap.filter((c) => c.diff > 0));
    const topUnder = maxByGap(catsWithGap.filter((c) => c.diff < 0));
    if (topOver || topUnder) {
      const sentences: string[] = [];
      if (topOver) sentences.push(`초과 폭이 가장 큰 구분은 <b>${describeGap(topOver.category, topOver)}</b>입니다.`);
      if (topUnder) sentences.push(`미집행 폭이 가장 큰 구분은 <b>${describeGap(topUnder.category, topUnder)}</b>입니다.`);
      setHtml(
        "catInsight",
        `<div class="callout info"><div class="ic">💡</div><div><b>${scopeLabel()} 요약</b> — ${sentences.join(" ")}</div></div>`
      );
    }

    setHtml(
      "feeTable",
      table5(
        fees.map((f: FeeRow) => row(f.account, f.actual, f.budget)).join("") +
          row("지급수수료 합계", fees.reduce((s, f) => s + f.actual, 0), fees.reduce((s, f) => s + f.budget, 0), "tot")
      )
    );
    setHtml("feeLegend", legendHtml([[C_BUDGET, "예산"], [C_ACTUAL2, "실적"]]));
    queueChart("category", "feeChart", () =>
      barChart("feeChart", fees.map((f) => f.account), fees.map((f) => f.actual), fees.map((f) => f.budget), { c1: C_ACTUAL2 })
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

    const feeAccounts = fees.map((f) => f.account);
    const palette = ["#2563eb", "#0f172a", "#dc2626", "#d97706", "#16a34a", "#7c3aed"];
    setHtml(
      "feeTrendLegend",
      legendLineHtml(
        feeAccounts.flatMap((a, i) => [
          { color: palette[i % palette.length], label: `${a} 예산`, dashed: true },
          { color: palette[i % palette.length], label: `${a} 실적` },
        ])
      )
    );
    queueChart("category", "feeTrendChart", () =>
      lineChartMulti(
        "feeTrendChart",
        months,
        feeAccounts.flatMap((acc, i) => {
          const series = trend.fee_by_account[acc] || [];
          const color = palette[i % palette.length];
          return [
            {
              label: `${acc} 예산`,
              data: series.map((x) => x.budget),
              borderColor: color,
              borderDash: [5, 4],
              backgroundColor: color,
              tension: 0.3,
              pointRadius: 2,
            },
            {
              label: `${acc} 실적`,
              data: series.map((x) => x.actual),
              borderColor: color,
              backgroundColor: color,
              tension: 0.3,
              pointRadius: 3,
            },
          ];
        })
      )
    );

    // 집행률 괴리와 금액이 둘 다 유의미할 때만, 원인이 되는 구분(부서) 1~2개를 "구분 +차이금액"으로 뽑는다.
    const mainAccountRemark = (r: MainAccountRow, hqTotalBudget: number): string =>
      attributionRemark(
        r.byDept.map((d) => ({ label: d.dept, actual: d.actual, budget: d.budget })),
        r.actual,
        r.budget,
        hqTotalBudget
      );

    const mainAccountTable = (rows: MainAccountRow[], hqTotalBudget: number): string => {
      const bodyRows = rows
        .map((r) => {
          const diff = r.actual - r.budget;
          return `<tr><td>${r.account}</td>
            <td${cls(r.budget)}>${fmtM(r.budget)}</td><td${cls(r.actual)}>${fmtM(r.actual)}</td>
            <td${diffCls(diff)}>${diff >= 0 ? "+" : ""}${fmtM(diff)}</td>
            <td class="badge-cell">${rateBadgeCell(rateOf(r.actual, r.budget))}</td>
            <td class="remark-cell">${mainAccountRemark(r, hqTotalBudget)}</td></tr>`;
        })
        .join("");
      const totA = rows.reduce((sum, r) => sum + r.actual, 0);
      const totB = rows.reduce((sum, r) => sum + r.budget, 0);
      const totDiff = totA - totB;
      const totRow = `<tr class="tot"><td>대계정 합계</td>
        <td>${fmtM(totB)}</td><td>${fmtM(totA)}</td>
        <td${diffCls(totDiff)}>${totDiff >= 0 ? "+" : ""}${fmtM(totDiff)}</td>
        <td class="badge-cell">${rateBadgeCell(rateOf(totA, totB))}</td>
        <td></td></tr>`;
      return `<table class="pl-tbl"><thead><tr><th>대계정</th><th>예산</th><th>실적</th><th>차이</th><th>집행률</th><th>비고</th></tr></thead><tbody>${bodyRows}${totRow}</tbody></table>`;
    };
    setText("hqMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("hqMainAccountTable", mainAccountTable(scope.mainAccountByHq["본사"], s.hq_totals["본사"].budget));
    setText("corpMainAccountTblSub", scopeLabel() + " · 백만원");
    setHtml("corpMainAccountTable", mainAccountTable(scope.mainAccountByHq["법인"], s.hq_totals["법인"].budget));
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

    setHtml("evcsSummaryTable", table5(row("국내", domA, domB) + row("해외", ovsA, ovsB) + row("국내+해외 합계", totA, totB, "tot")));
    setHtml("evcsLegend", legendHtml([[C_BUDGET, "예산"], [C_ACTUAL, "실적"]]));
    queueChart("evcs", "evcsChart", () => barChart("evcsChart", ["국내", "해외"], [domA, ovsA], [domB, ovsB]));

    const domRate = rateOf(domA, domB),
      ovsRate = rateOf(ovsA, ovsB);
    const domHigher = domRate !== null && domRate !== Infinity && domRate > 110;
    const ovsHigher = ovsRate !== null && ovsRate !== Infinity && ovsRate > 110;
    let insightMsg = `EVCS는 당사 주력 사업부로 ${scopeLabel()} 기준 해외 비중이 ${Math.round((ovsA / (totA || 1)) * 100)}%를 차지합니다.`;
    if (domHigher || ovsHigher) {
      insightMsg += ` ${domHigher ? "국내" : ""}${domHigher && ovsHigher ? ", " : ""}${ovsHigher ? "해외" : ""} 집행률이 예산 대비 110%를 초과했습니다.`;
    }
    setHtml("evcsInsight", `<div class="callout info"><div class="ic">🔋</div><div>${insightMsg}</div></div>`);

    setHtml(
      "evcsTrendLegend",
      legendLineHtml([
        { color: "#0891b2", label: "국내 예산", dashed: true },
        { color: "#0891b2", label: "국내 실적" },
        { color: "#0f172a", label: "해외 예산", dashed: true },
        { color: "#0f172a", label: "해외 실적" },
      ])
    );
    queueChart("evcs", "evcsTrendChart", () =>
      lineChartMulti("evcsTrendChart", months, [
        { label: "국내 예산", data: trend.evcs_domestic.map((x) => x.budget), borderColor: "#0891b2", borderDash: [5, 4], backgroundColor: "#0891b2", tension: 0.3, pointRadius: 2 },
        { label: "국내 실적", data: trend.evcs_domestic.map((x) => x.actual), borderColor: "#0891b2", backgroundColor: "#0891b2", tension: 0.3 },
        { label: "해외 예산", data: trend.evcs_overseas.map((x) => x.budget), borderColor: "#0f172a", borderDash: [5, 4], backgroundColor: "#0f172a", tension: 0.3, pointRadius: 2 },
        { label: "해외 실적", data: trend.evcs_overseas.map((x) => x.actual), borderColor: "#0f172a", backgroundColor: "#0f172a", tension: 0.3 },
      ])
    );

    let catHtml = `<table class="pl-tbl"><thead><tr><th>구분</th><th>국내 예산</th><th>국내 실적</th><th>국내 차이</th><th>국내 집행률</th><th>해외 예산</th><th>해외 실적</th><th>해외 차이</th><th>해외 집행률</th></tr></thead><tbody>`;
    e.byCategory.forEach((c) => {
      const dr = rateOf(c.dom_actual, c.dom_budget);
      const or_ = rateOf(c.ovs_actual, c.ovs_budget);
      const domDiff = c.dom_actual - c.dom_budget;
      const ovsDiff = c.ovs_actual - c.ovs_budget;
      catHtml += `<tr><td>${c.category}</td>
        <td${cls(c.dom_budget)}>${fmtM(c.dom_budget)}</td><td${cls(c.dom_actual)}>${fmtM(c.dom_actual)}</td>
        <td${diffCls(domDiff)}>${domDiff >= 0 ? "+" : ""}${fmtM(domDiff)}</td><td class="badge-cell">${rateBadgeCell(dr)}</td>
        <td${cls(c.ovs_budget)}>${fmtM(c.ovs_budget)}</td><td${cls(c.ovs_actual)}>${fmtM(c.ovs_actual)}</td>
        <td${diffCls(ovsDiff)}>${ovsDiff >= 0 ? "+" : ""}${fmtM(ovsDiff)}</td><td class="badge-cell">${rateBadgeCell(or_)}</td></tr>`;
    });
    catHtml += "</tbody></table>";
    setHtml("evcsCatTable", catHtml);

    const cd = e.certAgency.domestic,
      co = e.certAgency.overseas;
    const cdRate = rateOf(cd.actual, cd.budget),
      coRate = rateOf(co.actual, co.budget);
    const certTotA = cd.actual + co.actual,
      certTotB = cd.budget + co.budget;

    setHtml("certTable", table5(row("국내", cd.actual, cd.budget) + row("해외", co.actual, co.budget) + row("합계", certTotA, certTotB, "tot")));
    setHtml("certLegend", legendHtml([["#fca5a5", "예산"], [C_ALT, "실적"]]));
    queueChart("evcs", "certChart", () => barChart("certChart", ["국내", "해외"], [cd.actual, co.actual], [cd.budget, co.budget], { c1: C_ALT, c2: "#fca5a5" }));

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

    // 인증대행료 추이 (당월까지만 조회 — 미경과 기간 확장은 위 콤보 차트로 이동)
    setHtml(
      "certTrendLegend",
      legendLineHtml([
        { color: C_ALT, label: "국내 예산", dashed: true },
        { color: C_ALT, label: "국내 실적" },
        { color: C_ALT2, label: "해외 예산", dashed: true },
        { color: C_ALT2, label: "해외 실적" },
      ])
    );
    queueChart("evcs", "certTrendChart", () =>
      lineChartMulti("certTrendChart", months, [
        { label: "국내 예산", data: trend.cert_domestic.map((x) => x.budget), borderColor: C_ALT, borderDash: [5, 4], backgroundColor: C_ALT, tension: 0.3, pointRadius: 2 },
        { label: "국내 실적", data: trend.cert_domestic.map((x) => x.actual), borderColor: C_ALT, backgroundColor: C_ALT, tension: 0.3 },
        { label: "해외 예산", data: trend.cert_overseas.map((x) => x.budget), borderColor: C_ALT2, borderDash: [5, 4], backgroundColor: C_ALT2, tension: 0.3, pointRadius: 2 },
        { label: "해외 실적", data: trend.cert_overseas.map((x) => x.actual), borderColor: C_ALT2, backgroundColor: C_ALT2, tension: 0.3 },
      ])
    );
  }

  function renderAll() {
    setText("topbarMeta", `단위: 백만원 · 기준월: ${currentMonth} · 보기: ${currentMode === "month" ? "당월" : "누계(YTD)"}`);
    renderSummary();
    renderCategory();
    renderEvcs();
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
