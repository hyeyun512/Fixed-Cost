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

export type FeeOrgMonthRow = { month: string; actual: number; budget: number };
export type FeeOrgAccountRow = { account: string; actual: number; budget: number };
export type FeeOrgCompanyRow = { company: string; actual: number; budget: number };
/** 조직(부문/법인) 기준 지급수수료 계열(지급수수료·외주개발용역비·인증대행료·특허처리비 합계) 집계. */
export type FeeOrgRow = {
  org: string;
  /** 0=부문/법인, 1=Staff부문 하위 대조직 — 표시 들여쓰기에 사용. */
  level: 0 | 1;
  actual: number;
  budget: number;
  byAccount: FeeOrgAccountRow[];
  /** 누계 보기에서 차이가 특정 월에 집중되었는지 판단하기 위한 월별 내역. */
  monthly: FeeOrgMonthRow[];
  /** 법인 행에서만 채워지는 소속사별 내역 — 비고에서 차이의 원인이 되는 법인을 짚어주기 위함. */
  byCompany?: FeeOrgCompanyRow[];
};

export type EvcsCatRow = {
  category: string;
  dom_actual: number;
  dom_budget: number;
  ovs_actual: number;
  ovs_budget: number;
};
export type EvcsBlock = {
  total: { domestic: AB; overseas: AB };
  /** total을 본사/법인 기준으로 나눈 값 (Summary②의 당월/당월누계 표용). */
  byHq: { 본사: { domestic: AB; overseas: AB }; 법인: { domestic: AB; overseas: AB } };
  byCategory: EvcsCatRow[];
  /** 구분별 EVCS 배부금액(국내+해외 합산)을 본사/법인 기준으로 나눈 값. */
  categoryByHq: CategoryByHq;
  /** EVCS 배부금액(국내+해외 합산) 기준 본사/법인/구분(re)/대계정 집계 — Summary와 동일한 드릴다운 요약에 재사용. */
  evcsSummary: SummaryBlock;
  /** EVCS 배부금액(국내+해외 합산) 기준 본사/법인별 대계정 상세 — 계정별 탭의 대계정별 상세와 동일한 형태. */
  mainAccountByHq: MainAccountByHq;
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

/** 배부판의 13개 기본 배부 사업부 금액 (STB~H.Networks, 그룹 합계는 별도 필드). */
export type AllocValues13 = {
  stb: number;
  mobility: number;
  evcsDomestic: number;
  evcsOverseas: number;
  humaxCommon: number;
  building: number;
  hMobility: number;
  hEv: number;
  hiparking: number;
  peoplecar: number;
  winercom: number;
  holdings: number;
  hNetworks: number;
};
/** 구분(category) 하나의 STB~건물 배부 내역 + (A)Humax 소계 — Summary③ 본사 구분별 상세용. */
export type HqCategoryAllocRow = AllocValues13 & { category: string; humaxTotal: number };
/** 대계정(re) 하나가 이 행의 배부 금액에 기여한 몫 (Diff 표 툴팁에서 원인 분석용). */
export type AllocAccountValues = AllocValues13 & { account: string };
/** 배부판 한 행: 회사/부문 기준으로 STB~H.Networks 13개 배부 사업부의 배부후금액을 모두 더한 값. */
export type AllocationRow = AllocValues13 & {
  label: string;
  /** 0=본사/법인/Total(볼드), 1=부문/법인사, 2=Staff부문 하위조직 — 표시 들여쓰기에 사용. */
  level: 0 | 1 | 2;
  /** (A) Humax 합계 = stb+mobility+evcsDomestic+evcsOverseas+humaxCommon */
  humaxTotal: number;
  /** (C) Shared 합계 = hMobility+hEv+hiparking+peoplecar+winercom+holdings+hNetworks */
  sharedTotal: number;
  /** (A+B+C) 총합계 */
  grandTotal: number;
  /** 이 행의 금액을 만들어낸 대계정(re)별 내역 — Diff 표에서 "무엇 때문에 차이가 났는지" 툴팁에 쓴다. */
  byAccount: AllocAccountValues[];
};
export type AllocationBoard = { budget: AllocationRow[]; actual: AllocationRow[] };

export type MonthBlock = {
  summary: SummaryBlock;
  category: CategoryRow[];
  categoryByHq: CategoryByHq;
  fee: FeeRow[];
  feeByOrg: FeeOrgRow[];
  evcs: EvcsBlock;
  mainAccountByHq: MainAccountByHq;
  allocationBoard: AllocationBoard;
  /** 본사 구분별(인건비~기타) STB~건물 배부 내역 — Summary③ 전용. */
  hqCategoryAlloc: HqCategoryAllocRow[];
  cumulative: {
    summary: SummaryBlock;
    category: CategoryRow[];
    categoryByHq: CategoryByHq;
    fee: FeeRow[];
    feeByOrg: FeeOrgRow[];
    evcs: EvcsBlock;
    mainAccountByHq: MainAccountByHq;
    allocationBoard: AllocationBoard;
    hqCategoryAlloc: HqCategoryAllocRow[];
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
