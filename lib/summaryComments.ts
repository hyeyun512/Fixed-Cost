/**
 * Summary① ~ ③ 탭의 [Summary] 코멘트 — 화면에서 직접 고치는 방식이 아니라, 보고 시점마다
 * 텍스트를 받아 이 파일을 수정해 배포하는 방식으로 관리한다 (경영진 보고용 고정 텍스트).
 * 아래 내용은 실제 데이터 확정 전 임의로 채운 샘플 문구다.
 */
export type SummaryCommentKey =
  | "humax_total_month"
  | "humax_total_cum"
  | "evcs"
  | "humax_detail";

/**
 * Humax합계_상세의 Summary — 배부 항목별로 나눠서 관리한다.
 * 각 항목은 "이렇게 움직여야 정상"이라는 방향성이 있어, 매월 추이가 그 방향과 맞는지 확인하는 용도다.
 *   STB        : Closing 사업 — 계속 줄어 결국 사라져야 함
 *   HUMAX(공통) : 감소 추세인지 관리 필요
 *   건물        : 사옥 이전에 따라 계단식으로 떨어져야 함
 */
export type SummaryCommentGroup = { label: string; lines: string[] };
export const SUMMARY_DETAIL_GROUPS: SummaryCommentGroup[] = [
  {
    label: "STB",
    lines: [
      "Closing 사업으로 배부액이 지속 감소해 종국에는 소멸해야 합니다.",
      "감소 속도가 둔화되면 잔여 인력·계약 정리 일정을 점검합니다.",
    ],
  },
  {
    label: "HUMAX(공통)",
    lines: [
      "전사 공통비로, 뚜렷한 감소 추세를 유지하도록 관리가 필요합니다.",
      "증가한 달은 일회성 요인인지 구조적 증가인지 구분해 확인합니다.",
    ],
  },
  {
    label: "건물",
    lines: [
      "사옥 이전에 맞춰 계단식 감소가 나타나야 합니다.",
      "이전 완료 이후에도 감소가 없으면 잔여 임차 계약을 확인합니다.",
    ],
  },
];

export const SUMMARY_COMMENTS: Record<SummaryCommentKey, string[]> = {
  humax_total_month: [
    "당월 집행률은 예산 범위 내에서 안정적으로 유지되고 있습니다.",
    "본사·법인 간 당월 집행 추이에 특이 편차는 없습니다.",
    "다음 달에는 계절적 요인으로 지급수수료 증가가 예상됩니다.",
  ],
  humax_total_cum: [
    "누계 집행률은 연간 계획 대비 정상 범위에서 관리되고 있습니다.",
    "본사가 누계 집행의 대부분을 차지하고 있습니다.",
    "EVCS(해외) 배부 비중이 누계 기준으로 가장 크게 나타났습니다.",
  ],
  evcs: [
    "국내 사업 철수에 따라 EVCS(국내) 비용의 감소 추세를 매월 점검하고 있습니다.",
    "EVCS(해외)는 사업 확대에 맞춰 점진적으로 증가할 것으로 예상됩니다.",
    "비용 규모는 인건비 비중이 가장 크며, 국내 인력 재배치 시점이 관건입니다.",
  ],
  humax_detail: [
    "본사 비용은 인건비·지급수수료 중심으로 집행되고 있습니다.",
    "법인은 HUK, HBR의 배부 비중이 상대적으로 높습니다.",
    "HTR/HDG/HAU는 비중이 미미하여 한 행으로 묶어 관리합니다.",
  ],
};
