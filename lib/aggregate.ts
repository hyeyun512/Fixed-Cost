import { getSupabaseAdmin } from "./supabaseAdmin";
import type {
  DashboardData,
  MonthBlock,
  SummaryBlock,
  SummaryRow,
  CategoryRow,
  CategoryByHq,
  FeeRow,
  EvcsBlock,
  EvcsCatRow,
  Trend,
  TrendPoint,
  FullTrendPoint,
  MainAccountRow,
  MainAccountByHq,
  AllocationRow,
  AllocationBoard,
} from "./types";

const BUDGET_TABLE = "26년 예산(BP)";
const PREFERRED_CATEGORY_ORDER = ["인건비", "지급수수료", "감가상각비", "기타", "광고선전비", "여비교통비"];
const PREFERRED_FEE_ORDER = ["29 지급수수료", "40 외주개발용역비", "41 인증대행료", "42 특허처리비"];
const HQ_ORDER: Record<string, number> = { 본사: 0, 법인: 1 };
const PREFERRED_HQ_DEPT_ORDER = ["1. 사업 그룹", "2. 개발 그룹", "3. SCM 부문", "4. Media그룹", "5. Staff부문"];
const PREFERRED_STAFF_SUBORG_ORDER = ["CEO", "Staff(CEO)", "경영지원실", "HR실"];
const STAFF_SUBORG_LABEL: Record<string, string> = { HR실: "HR팀" };
const PREFERRED_CORP_COMPANY_ORDER = ["HUS", "HMX", "HUK", "HDG", "HUG", "HTR", "HBR", "HJP", "HTH", "HAU", "HID", "HSZ"];

type Row = {
  month: string;
  hq_corp: string | null;
  report_use_re: string | null;
  company: string | null;
  large_org: string | null;
  category: string | null;
  main_account_re: string | null;
  amount_krw: number | null;
  evcs_domestic_krw: number | null;
  evcs_overseas_krw: number | null;
  stb_krw: number | null;
  mobility_krw: number | null;
  humax_common_krw: number | null;
  building_krw: number | null;
  h_mobility_krw: number | null;
  h_ev_krw: number | null;
  hiparking_krw: number | null;
  peoplecar_krw: number | null;
  winercom_krw: number | null;
  holdings_krw: number | null;
  h_networks_krw: number | null;
};

const COLUMNS =
  "month,hq_corp,report_use_re,company,large_org,category,main_account_re,amount_krw,evcs_domestic_krw,evcs_overseas_krw,stb_krw,mobility_krw,humax_common_krw,building_krw,h_mobility_krw,h_ev_krw,hiparking_krw,peoplecar_krw,winercom_krw,holdings_krw,h_networks_krw";

async function fetchAllRows(
  table: string,
  filterMonths?: string[]
): Promise<Row[]> {
  const supabase = getSupabaseAdmin();
  const pageSize = 1000;
  let from = 0;
  const rows: Row[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = supabase.from(table).select(COLUMNS).range(from, from + pageSize - 1);
    if (filterMonths && filterMonths.length) {
      q = q.in("month", filterMonths);
    }
    const { data, error } = await q;
    if (error) {
      throw new Error(`Supabase 조회 실패 (${table}): ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function monthNum(m: string): number {
  return parseInt(m.replace("월", ""), 10) || 0;
}

function orderedUnique(seen: Set<string>, preferred: string[]): string[] {
  const rest = [...seen].filter((v) => !preferred.includes(v)).sort((a, b) => a.localeCompare(b, "ko"));
  return [...preferred.filter((v) => seen.has(v)), ...rest];
}

function n(v: number | null | undefined): number {
  return v == null ? 0 : v;
}

export async function loadDashboardData(): Promise<DashboardData> {
  const supabase = getSupabaseAdmin();

  const { data: tableNameData, error: rpcError } = await supabase.rpc("fc_latest_actual_table");
  if (rpcError) throw new Error(`실적 테이블 탐색 실패: ${rpcError.message}`);
  const actualTable = tableNameData as string;
  if (!actualTable) throw new Error('"26년 실적_N월 누계" 형태의 테이블을 찾지 못했습니다.');

  const actualRows = await fetchAllRows(actualTable);

  const monthSet = new Set(actualRows.map((r) => r.month));
  const months = [...monthSet].sort((a, b) => monthNum(a) - monthNum(b));
  if (months.length === 0) throw new Error(`${actualTable} 테이블에 데이터가 없습니다.`);
  const defaultMonth = months[months.length - 1];

  const budgetRows = await fetchAllRows(BUDGET_TABLE, months);
  // 예산은 연간 전체(1~12월)가 미리 잡혀 있는 경우가 많아, 미경과 기간 예산선 표시를 위해 전체를 따로 받아둔다.
  const budgetRowsFullYear = await fetchAllRows(BUDGET_TABLE);
  const allMonths = [...new Set(budgetRowsFullYear.map((r) => r.month))].sort((a, b) => monthNum(a) - monthNum(b));

  const categorySet = new Set<string>();
  const feeSet = new Set<string>();
  const mainAccountSet = new Set<string>();
  for (const r of [...actualRows, ...budgetRows]) {
    if (r.category) categorySet.add(r.category);
    if (r.category === "지급수수료" && r.main_account_re) feeSet.add(r.main_account_re);
    if (r.main_account_re) mainAccountSet.add(r.main_account_re);
  }
  const catOrder = orderedUnique(categorySet, PREFERRED_CATEGORY_ORDER);
  const feeOrder = orderedUnique(feeSet, PREFERRED_FEE_ORDER);

  // 배부판 행 구조 (본사 부문 / Staff부문 하위조직 / 법인 소속사) — 연간 전체 데이터 기준으로 한 번만 산출.
  const hqDeptSet = new Set<string>();
  const staffSubSet = new Set<string>();
  const corpCompanySet = new Set<string>();
  for (const r of [...actualRows, ...budgetRows]) {
    const hq = r.hq_corp || "기타";
    if (hq === "본사" && r.report_use_re) {
      hqDeptSet.add(r.report_use_re);
      if (r.report_use_re === "5. Staff부문" && r.large_org) staffSubSet.add(r.large_org);
    }
    if (hq === "법인") {
      const co = r.report_use_re || r.company;
      if (co) corpCompanySet.add(co);
    }
  }
  const hqDeptOrder = orderedUnique(hqDeptSet, PREFERRED_HQ_DEPT_ORDER);
  const staffSubOrder = orderedUnique(staffSubSet, PREFERRED_STAFF_SUBORG_ORDER);
  const corpCompanyOrder = orderedUnique(corpCompanySet, PREFERRED_CORP_COMPANY_ORDER);

  // 대계정(re) -> 구분(category) 매핑 (한 대계정은 하나의 구분에만 속함).
  const mainAccountCategory = new Map<string, string>();
  for (const r of [...actualRows, ...budgetRows]) {
    if (r.main_account_re && r.category && !mainAccountCategory.has(r.main_account_re)) {
      mainAccountCategory.set(r.main_account_re, r.category);
    }
  }
  const catRank = new Map(catOrder.map((c, i) => [c, i]));
  // 대계정은 구분별 상세와 같은 구분 순서로 묶고, 같은 구분 내에서는 "11 급여"처럼 앞자리 숫자(계정 코드) 순으로 정렬한다.
  const mainAccountOrder = [...mainAccountSet].sort((a, b) => {
    const ca = catRank.get(mainAccountCategory.get(a) || "") ?? 999;
    const cb = catRank.get(mainAccountCategory.get(b) || "") ?? 999;
    if (ca !== cb) return ca - cb;
    const na = parseInt(a, 10),
      nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, "ko");
  });
  // "11 급여" -> "급여"처럼 화면 표시용으로 앞자리 계정 코드를 뗀다.
  function stripAccountNumber(acc: string): string {
    return acc.replace(/^\d+\s*/, "");
  }

  function sumByHqDept(rows: Row[]): { map: Map<string, SummaryRow>; byAccount: Map<string, Map<string, number>> } {
    const map = new Map<string, SummaryRow>();
    const byAccount = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const hq = r.hq_corp || "기타";
      const dept = r.report_use_re || "미분류";
      const key = hq + "|" + dept;
      const cur = map.get(key) || { hq_corp: hq, dept, actual: 0, budget: 0, byMainAccount: [] };
      cur.actual += n(r.amount_krw);
      map.set(key, cur);
      if (r.main_account_re) {
        const am = byAccount.get(key) || new Map<string, number>();
        am.set(r.main_account_re, (am.get(r.main_account_re) || 0) + n(r.amount_krw));
        byAccount.set(key, am);
      }
    }
    return { map, byAccount };
  }
  function addBudgetToMap(
    map: Map<string, SummaryRow>,
    byAccount: Map<string, Map<string, number>>,
    rows: Row[]
  ) {
    for (const r of rows) {
      const hq = r.hq_corp || "기타";
      const dept = r.report_use_re || "미분류";
      const key = hq + "|" + dept;
      const cur = map.get(key) || { hq_corp: hq, dept, actual: 0, budget: 0, byMainAccount: [] };
      cur.budget += n(r.amount_krw);
      map.set(key, cur);
      if (r.main_account_re) {
        const am = byAccount.get(key) || new Map<string, number>();
        am.set(r.main_account_re, (am.get(r.main_account_re) || 0) + n(r.amount_krw));
        byAccount.set(key, am);
      }
    }
  }

  function summaryForRows(actRows: Row[], budRows: Row[]): SummaryBlock {
    const { map, byAccount: actByAccount } = sumByHqDept(actRows);
    const budByAccount = new Map<string, Map<string, number>>();
    addBudgetToMap(map, budByAccount, budRows);
    for (const [key, sr] of map) {
      const accounts = new Set<string>([...(actByAccount.get(key)?.keys() || []), ...(budByAccount.get(key)?.keys() || [])]);
      sr.byMainAccount = [...accounts].map((acc) => ({
        account: acc,
        actual: actByAccount.get(key)?.get(acc) || 0,
        budget: budByAccount.get(key)?.get(acc) || 0,
      }));
    }
    const rows = [...map.values()].sort(
      (a, b) => (HQ_ORDER[a.hq_corp] ?? 9) - (HQ_ORDER[b.hq_corp] ?? 9) || a.dept.localeCompare(b.dept, "ko")
    );
    const hq_totals: Record<string, { actual: number; budget: number }> = {};
    for (const hq of ["본사", "법인"]) {
      hq_totals[hq] = {
        actual: rows.filter((r) => r.hq_corp === hq).reduce((s, r) => s + r.actual, 0),
        budget: rows.filter((r) => r.hq_corp === hq).reduce((s, r) => s + r.budget, 0),
      };
    }
    const total = {
      actual: rows.reduce((s, r) => s + r.actual, 0),
      budget: rows.reduce((s, r) => s + r.budget, 0),
    };
    return { rows, hq_totals, total };
  }

  function categoryForRows(actRows: Row[], budRows: Row[], hq?: string): CategoryRow[] {
    const act = new Map<string, number>();
    const bud = new Map<string, number>();
    for (const r of actRows)
      if (r.category && (!hq || (r.hq_corp || "기타") === hq)) act.set(r.category, (act.get(r.category) || 0) + n(r.amount_krw));
    for (const r of budRows)
      if (r.category && (!hq || (r.hq_corp || "기타") === hq)) bud.set(r.category, (bud.get(r.category) || 0) + n(r.amount_krw));
    return catOrder.map((c) => ({ category: c, actual: act.get(c) || 0, budget: bud.get(c) || 0 }));
  }
  function categoryByHqForRows(actRows: Row[], budRows: Row[]): CategoryByHq {
    return {
      총합계: categoryForRows(actRows, budRows),
      본사: categoryForRows(actRows, budRows, "본사"),
      법인: categoryForRows(actRows, budRows, "법인"),
    };
  }

  function feeForRows(actRows: Row[], budRows: Row[]): FeeRow[] {
    const act = new Map<string, number>();
    const bud = new Map<string, number>();
    // 지급수수료 대계정별로 어느 구분(re)이 실적/예산을 냈는지도 쌓아둔다 (비고란의 원인 부서 표기용).
    const actByDept = new Map<string, Map<string, number>>();
    const budByDept = new Map<string, Map<string, number>>();
    for (const r of actRows) {
      if (r.category !== "지급수수료" || !r.main_account_re) continue;
      act.set(r.main_account_re, (act.get(r.main_account_re) || 0) + n(r.amount_krw));
      const dept = r.report_use_re || "미분류";
      const dm = actByDept.get(r.main_account_re) || new Map<string, number>();
      dm.set(dept, (dm.get(dept) || 0) + n(r.amount_krw));
      actByDept.set(r.main_account_re, dm);
    }
    for (const r of budRows) {
      if (r.category !== "지급수수료" || !r.main_account_re) continue;
      bud.set(r.main_account_re, (bud.get(r.main_account_re) || 0) + n(r.amount_krw));
      const dept = r.report_use_re || "미분류";
      const dm = budByDept.get(r.main_account_re) || new Map<string, number>();
      dm.set(dept, (dm.get(dept) || 0) + n(r.amount_krw));
      budByDept.set(r.main_account_re, dm);
    }
    return feeOrder.map((a) => {
      const depts = new Set<string>([...(actByDept.get(a)?.keys() || []), ...(budByDept.get(a)?.keys() || [])]);
      const byDept = [...depts].map((dept) => ({
        dept,
        actual: actByDept.get(a)?.get(dept) || 0,
        budget: budByDept.get(a)?.get(dept) || 0,
      }));
      return { account: a, actual: act.get(a) || 0, budget: bud.get(a) || 0, byDept };
    });
  }

  function mainAccountForHq(actRows: Row[], budRows: Row[], hq: string): MainAccountRow[] {
    const act = new Map<string, number>();
    const bud = new Map<string, number>();
    // 대계정별로 어느 구분(부서)이 실적/예산을 냈는지도 함께 쌓아둔다 (비고란의 원인 부서 표기용).
    const actByDept = new Map<string, Map<string, number>>();
    const budByDept = new Map<string, Map<string, number>>();
    for (const r of actRows) {
      if (!r.main_account_re || (r.hq_corp || "기타") !== hq) continue;
      act.set(r.main_account_re, (act.get(r.main_account_re) || 0) + n(r.amount_krw));
      const dept = r.report_use_re || "미분류";
      const dm = actByDept.get(r.main_account_re) || new Map<string, number>();
      dm.set(dept, (dm.get(dept) || 0) + n(r.amount_krw));
      actByDept.set(r.main_account_re, dm);
    }
    for (const r of budRows) {
      if (!r.main_account_re || (r.hq_corp || "기타") !== hq) continue;
      bud.set(r.main_account_re, (bud.get(r.main_account_re) || 0) + n(r.amount_krw));
      const dept = r.report_use_re || "미분류";
      const dm = budByDept.get(r.main_account_re) || new Map<string, number>();
      dm.set(dept, (dm.get(dept) || 0) + n(r.amount_krw));
      budByDept.set(r.main_account_re, dm);
    }
    return mainAccountOrder
      .filter((a) => act.has(a) || bud.has(a))
      .map((a) => {
        const depts = new Set<string>([...(actByDept.get(a)?.keys() || []), ...(budByDept.get(a)?.keys() || [])]);
        const byDept = [...depts].map((dept) => ({
          dept,
          actual: actByDept.get(a)?.get(dept) || 0,
          budget: budByDept.get(a)?.get(dept) || 0,
        }));
        return {
          account: a,
          accountLabel: stripAccountNumber(a),
          category: mainAccountCategory.get(a) || "",
          actual: act.get(a) || 0,
          budget: bud.get(a) || 0,
          byDept,
        };
      });
  }
  function mainAccountByHqForRows(actRows: Row[], budRows: Row[]): MainAccountByHq {
    return {
      본사: mainAccountForHq(actRows, budRows, "본사"),
      법인: mainAccountForHq(actRows, budRows, "법인"),
    };
  }

  function evcsForRows(actRows: Row[], budRows: Row[]): EvcsBlock {
    const totA = { dom: 0, ovs: 0 };
    const totB = { dom: 0, ovs: 0 };
    for (const r of actRows) {
      totA.dom += n(r.evcs_domestic_krw);
      totA.ovs += n(r.evcs_overseas_krw);
    }
    for (const r of budRows) {
      totB.dom += n(r.evcs_domestic_krw);
      totB.ovs += n(r.evcs_overseas_krw);
    }
    const catA = new Map<string, { dom: number; ovs: number }>();
    const catB = new Map<string, { dom: number; ovs: number }>();
    for (const r of actRows) {
      if (!r.category) continue;
      const cur = catA.get(r.category) || { dom: 0, ovs: 0 };
      cur.dom += n(r.evcs_domestic_krw);
      cur.ovs += n(r.evcs_overseas_krw);
      catA.set(r.category, cur);
    }
    for (const r of budRows) {
      if (!r.category) continue;
      const cur = catB.get(r.category) || { dom: 0, ovs: 0 };
      cur.dom += n(r.evcs_domestic_krw);
      cur.ovs += n(r.evcs_overseas_krw);
      catB.set(r.category, cur);
    }
    const byCategory: EvcsCatRow[] = catOrder.map((c) => ({
      category: c,
      dom_actual: catA.get(c)?.dom || 0,
      dom_budget: catB.get(c)?.dom || 0,
      ovs_actual: catA.get(c)?.ovs || 0,
      ovs_budget: catB.get(c)?.ovs || 0,
    }));
    const certA = { dom: 0, ovs: 0 };
    const certB = { dom: 0, ovs: 0 };
    for (const r of actRows) {
      if (r.main_account_re === "41 인증대행료") {
        certA.dom += n(r.evcs_domestic_krw);
        certA.ovs += n(r.evcs_overseas_krw);
      }
    }
    for (const r of budRows) {
      if (r.main_account_re === "41 인증대행료") {
        certB.dom += n(r.evcs_domestic_krw);
        certB.ovs += n(r.evcs_overseas_krw);
      }
    }
    return {
      total: { domestic: { actual: totA.dom, budget: totB.dom }, overseas: { actual: totA.ovs, budget: totB.ovs } },
      byCategory,
      certAgency: {
        domestic: { actual: certA.dom, budget: certB.dom },
        overseas: { actual: certA.ovs, budget: certB.ovs },
      },
    };
  }

  function allocationRow(label: string, level: 0 | 1 | 2, rows: Row[]): AllocationRow {
    let stb = 0,
      mobility = 0,
      evcsDomestic = 0,
      evcsOverseas = 0,
      humaxCommon = 0,
      building = 0,
      hMobility = 0,
      hEv = 0,
      hiparking = 0,
      peoplecar = 0,
      winercom = 0,
      holdings = 0,
      hNetworks = 0;
    for (const r of rows) {
      stb += n(r.stb_krw);
      mobility += n(r.mobility_krw);
      evcsDomestic += n(r.evcs_domestic_krw);
      evcsOverseas += n(r.evcs_overseas_krw);
      humaxCommon += n(r.humax_common_krw);
      building += n(r.building_krw);
      hMobility += n(r.h_mobility_krw);
      hEv += n(r.h_ev_krw);
      hiparking += n(r.hiparking_krw);
      peoplecar += n(r.peoplecar_krw);
      winercom += n(r.winercom_krw);
      holdings += n(r.holdings_krw);
      hNetworks += n(r.h_networks_krw);
    }
    const humaxTotal = stb + mobility + evcsDomestic + evcsOverseas + humaxCommon;
    const sharedTotal = hMobility + hEv + hiparking + peoplecar + winercom + holdings + hNetworks;
    return {
      label,
      level,
      stb,
      mobility,
      evcsDomestic,
      evcsOverseas,
      humaxCommon,
      humaxTotal,
      building,
      hMobility,
      hEv,
      hiparking,
      peoplecar,
      winercom,
      holdings,
      hNetworks,
      sharedTotal,
      grandTotal: humaxTotal + building + sharedTotal,
    };
  }

  function buildAllocationBoard(rows: Row[]): AllocationRow[] {
    const board: AllocationRow[] = [];
    const hqRows = rows.filter((r) => (r.hq_corp || "기타") === "본사");
    board.push(allocationRow("본사(HKR)", 0, hqRows));
    for (const dept of hqDeptOrder) {
      const deptRows = hqRows.filter((r) => (r.report_use_re || "미분류") === dept);
      board.push(allocationRow(dept, 1, deptRows));
      if (dept === "5. Staff부문") {
        for (const sub of staffSubOrder) {
          const subRows = deptRows.filter((r) => (r.large_org || "미분류") === sub);
          board.push(allocationRow(STAFF_SUBORG_LABEL[sub] || sub, 2, subRows));
        }
      }
    }
    const corpRows = rows.filter((r) => (r.hq_corp || "기타") === "법인");
    board.push(allocationRow("법인", 0, corpRows));
    for (const co of corpCompanyOrder) {
      const coRows = corpRows.filter((r) => (r.report_use_re || r.company || "미분류") === co);
      board.push(allocationRow(co, 1, coRows));
    }
    board.push(allocationRow("Total", 0, rows));
    return board;
  }
  function allocationBoardForRows(actRows: Row[], budRows: Row[]): AllocationBoard {
    return { budget: buildAllocationBoard(budRows), actual: buildAllocationBoard(actRows) };
  }

  const byMonth: Record<string, MonthBlock> = {};
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const actM = actualRows.filter((r) => r.month === m);
    const budM = budgetRows.filter((r) => r.month === m);
    const monthsUpTo = months.slice(0, i + 1);
    const actCum = actualRows.filter((r) => monthsUpTo.includes(r.month));
    const budCum = budgetRows.filter((r) => monthsUpTo.includes(r.month));

    byMonth[m] = {
      summary: summaryForRows(actM, budM),
      category: categoryForRows(actM, budM),
      categoryByHq: categoryByHqForRows(actM, budM),
      fee: feeForRows(actM, budM),
      evcs: evcsForRows(actM, budM),
      mainAccountByHq: mainAccountByHqForRows(actM, budM),
      allocationBoard: allocationBoardForRows(actM, budM),
      cumulative: {
        summary: summaryForRows(actCum, budCum),
        category: categoryForRows(actCum, budCum),
        categoryByHq: categoryByHqForRows(actCum, budCum),
        fee: feeForRows(actCum, budCum),
        evcs: evcsForRows(actCum, budCum),
        mainAccountByHq: mainAccountByHqForRows(actCum, budCum),
        allocationBoard: allocationBoardForRows(actCum, budCum),
        label: i === 0 ? `${months[0]} (누계=당월과 동일)` : `${months[0]}~${m} 누계`,
      },
    };
  }

  function point(m: string, actual: number, budget: number): TrendPoint {
    return { month: m, actual, budget };
  }
  const trend: Trend = {
    months,
    summary_total: months.map((m) => point(m, byMonth[m].summary.total.actual, byMonth[m].summary.total.budget)),
    evcs_domestic: months.map((m) =>
      point(m, byMonth[m].evcs.total.domestic.actual, byMonth[m].evcs.total.domestic.budget)
    ),
    evcs_overseas: months.map((m) =>
      point(m, byMonth[m].evcs.total.overseas.actual, byMonth[m].evcs.total.overseas.budget)
    ),
    cert_domestic: months.map((m) =>
      point(m, byMonth[m].evcs.certAgency.domestic.actual, byMonth[m].evcs.certAgency.domestic.budget)
    ),
    cert_overseas: months.map((m) =>
      point(m, byMonth[m].evcs.certAgency.overseas.actual, byMonth[m].evcs.certAgency.overseas.budget)
    ),
    fee_by_account: Object.fromEntries(
      feeOrder.map((acc) => [
        acc,
        months.map((m) => {
          const row = byMonth[m].fee.find((f) => f.account === acc);
          return point(m, row?.actual || 0, row?.budget || 0);
        }),
      ])
    ),
    ...buildFullYearTrend(),
  };

  // 미경과 기간(예: 6월 실적까지 있고 12월까지 예산이 잡혀있는 경우) 예산선을 12월까지 그리기 위한 전체 연간 집계.
  // 실적은 실제 데이터가 있는 달까지만 채우고, 그 이후는 null로 두어 차트에서 끊어진 상태로 표시한다.
  function buildFullYearTrend(): Pick<Trend, "cert_domestic_full" | "cert_overseas_full" | "fee_by_account_full"> {
    const monthsWithActual = new Set(months);
    const certBudget = new Map<string, { dom: number; ovs: number }>();
    const feeBudget = new Map<string, Map<string, number>>();
    for (const r of budgetRowsFullYear) {
      if (r.main_account_re === "41 인증대행료") {
        const cur = certBudget.get(r.month) || { dom: 0, ovs: 0 };
        cur.dom += n(r.evcs_domestic_krw);
        cur.ovs += n(r.evcs_overseas_krw);
        certBudget.set(r.month, cur);
      }
      if (r.category === "지급수수료" && r.main_account_re) {
        const dm = feeBudget.get(r.month) || new Map<string, number>();
        dm.set(r.main_account_re, (dm.get(r.main_account_re) || 0) + n(r.amount_krw));
        feeBudget.set(r.month, dm);
      }
    }
    const fullPoint = (m: string, actual: number | null, budget: number): FullTrendPoint => ({ month: m, actual, budget });
    const cert_domestic_full = allMonths.map((m) =>
      fullPoint(
        m,
        monthsWithActual.has(m) ? byMonth[m].evcs.certAgency.domestic.actual : null,
        certBudget.get(m)?.dom || 0
      )
    );
    const cert_overseas_full = allMonths.map((m) =>
      fullPoint(
        m,
        monthsWithActual.has(m) ? byMonth[m].evcs.certAgency.overseas.actual : null,
        certBudget.get(m)?.ovs || 0
      )
    );
    const fee_by_account_full = Object.fromEntries(
      feeOrder.map((acc) => [
        acc,
        allMonths.map((m) => {
          const actualRow = monthsWithActual.has(m) ? byMonth[m].fee.find((f) => f.account === acc) : undefined;
          return fullPoint(
            m,
            monthsWithActual.has(m) ? actualRow?.actual || 0 : null,
            feeBudget.get(m)?.get(acc) || 0
          );
        }),
      ])
    );
    return { cert_domestic_full, cert_overseas_full, fee_by_account_full };
  }

  return {
    months,
    allMonths,
    defaultMonth,
    generatedAt: new Date().toISOString(),
    sourceTable: actualTable,
    byMonth,
    trend,
  };
}
