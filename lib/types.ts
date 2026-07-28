export type AB = { actual: number; budget: number };

export type SummaryMainAccountRow = { account: string; actual: number; budget: number };
export type SummaryRow = {
  hq_corp: string;
  dept: string;
  actual: number;
  budget: number;
  byMainAccount: SummaryMainAccountRow[];
};
export type SummaryBlock = {
  rows: SummaryRow[];
  hq_totals: Record<string, AB>;
  total: AB;
};

export type CategoryRow = { category: string; actual: number; budget: number };
export type CategoryByHq = { 총합계: CategoryRow[]; 본사: CategoryRow[]; 법인: CategoryRow[] };
export type FeeDeptRow = { dept: string; actual: number; budget: number };
export type FeeRow = { account: string; actual: number; budget: number; byDept: FeeDeptRow[] };

export type EvcsCatRow = {
  category: string;
  dom_actual: number;
  dom_budget: number;
  ovs_actual: number;
  ovs_budget: number;
};
export type EvcsBlock = {
  total: { domestic: AB; overseas: AB };
  byCategory: EvcsCatRow[];
  certAgency: { domestic: AB; overseas: AB };
};

export type MainAccountDeptRow = { dept: string; actual: number; budget: number };
export type MainAccountRow = {
  account: string;
  /** 번호 접두어(예: "11 ")를 뺀 표시용 이름. */
  accountLabel: string;
  category: string;
  actual: number;
  budget: number;
  byDept: MainAccountDeptRow[];
};
export type MainAccountByHq = { 본사: MainAccountRow[]; 법인: MainAccountRow[] };

/** 배부판 한 행: 회사/부문 기준으로 STB~H.Networks 13개 배부 사업부의 배부후금액을 모두 더한 값. */
export type AllocationRow = {
  label: string;
  /** 0=본사/법인/Total(볼드), 1=부문/법인사, 2=Staff부문 하위조직 — 표시 들여쓰기에 사용. */
  level: 0 | 1 | 2;
  stb: number;
  mobility: number;
  evcsDomestic: number;
  evcsOverseas: number;
  humaxCommon: number;
  /** (A) Humax 합계 = stb+mobility+evcsDomestic+evcsOverseas+humaxCommon */
  humaxTotal: number;
  /** (B) 건물 */
  building: number;
  hMobility: number;
  hEv: number;
  hiparking: number;
  peoplecar: number;
  winercom: number;
  holdings: number;
  hNetworks: number;
  /** (C) Shared 합계 = hMobility+hEv+hiparking+peoplecar+winercom+holdings+hNetworks */
  sharedTotal: number;
  /** (A+B+C) 총합계 */
  grandTotal: number;
};
export type AllocationBoard = { budget: AllocationRow[]; actual: AllocationRow[] };

export type MonthBlock = {
  summary: SummaryBlock;
  category: CategoryRow[];
  categoryByHq: CategoryByHq;
  fee: FeeRow[];
  evcs: EvcsBlock;
  mainAccountByHq: MainAccountByHq;
  allocationBoard: AllocationBoard;
  cumulative: {
    summary: SummaryBlock;
    category: CategoryRow[];
    categoryByHq: CategoryByHq;
    fee: FeeRow[];
    evcs: EvcsBlock;
    mainAccountByHq: MainAccountByHq;
    allocationBoard: AllocationBoard;
    label: string;
  };
};

export type TrendPoint = { month: string; actual: number; budget: number };
/** 실적이 아직 없는(미경과) 월은 actual이 null — 차트에서 끊어진 상태로 표시하기 위함. */
export type FullTrendPoint = { month: string; actual: number | null; budget: number };
export type Trend = {
  months: string[];
  summary_total: TrendPoint[];
  evcs_domestic: TrendPoint[];
  evcs_overseas: TrendPoint[];
  cert_domestic: TrendPoint[];
  cert_overseas: TrendPoint[];
  fee_by_account: Record<string, TrendPoint[]>;
  /** 예산은 연말(12월)까지, 실적은 당월까지만 채워진 전체 연간 추이 (미경과 기간 표시용). */
  cert_domestic_full: FullTrendPoint[];
  cert_overseas_full: FullTrendPoint[];
  fee_by_account_full: Record<string, FullTrendPoint[]>;
};

export type DashboardData = {
  months: string[];
  /** 예산 테이블 기준 연간 전체 월 목록 (1월~12월, 미경과 기간 포함). */
  allMonths: string[];
  defaultMonth: string;
  generatedAt: string;
  sourceTable: string;
  byMonth: Record<string, MonthBlock>;
  trend: Trend;
};
