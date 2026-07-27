export type AB = { actual: number; budget: number };

export type SummaryRow = { hq_corp: string; dept: string; actual: number; budget: number };
export type SummaryBlock = {
  rows: SummaryRow[];
  hq_totals: Record<string, AB>;
  total: AB;
};

export type CategoryRow = { category: string; actual: number; budget: number };
export type FeeRow = { account: string; actual: number; budget: number };

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

export type MainAccountRow = { account: string; actual: number; budget: number };
export type MainAccountByHq = { 본사: MainAccountRow[]; 법인: MainAccountRow[] };

export type MonthBlock = {
  summary: SummaryBlock;
  category: CategoryRow[];
  fee: FeeRow[];
  evcs: EvcsBlock;
  mainAccountByHq: MainAccountByHq;
  cumulative: {
    summary: SummaryBlock;
    category: CategoryRow[];
    fee: FeeRow[];
    evcs: EvcsBlock;
    mainAccountByHq: MainAccountByHq;
    label: string;
  };
};

export type TrendPoint = { month: string; actual: number; budget: number };
export type Trend = {
  months: string[];
  summary_total: TrendPoint[];
  evcs_domestic: TrendPoint[];
  evcs_overseas: TrendPoint[];
  cert_domestic: TrendPoint[];
  cert_overseas: TrendPoint[];
  fee_by_account: Record<string, TrendPoint[]>;
};

export type DashboardData = {
  months: string[];
  defaultMonth: string;
  generatedAt: string;
  sourceTable: string;
  byMonth: Record<string, MonthBlock>;
  trend: Trend;
};
