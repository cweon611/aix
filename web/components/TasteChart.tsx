import { AXES, AXIS_META, type TasteVector } from "@/lib/types";

/**
 * 5축 미니 막대 차트. 추천 카드마다 붙여 "왜 이게 나왔는지"를 한눈에 보여 준다.
 * 축 색은 취향 입력 슬라이더와 같아서, 사용자가 민 슬라이더와 눈으로 대조된다.
 */
export function TasteChart({
  taste,
  reference,
  height = 30,
}: {
  taste: TasteVector;
  /** 사용자의 취향. 주면 각 축 위에 목표선을 겹쳐 그린다. */
  reference?: TasteVector;
  height?: number;
}) {
  return (
    <div className="flex items-end gap-2.5" aria-hidden="true">
      {AXES.map((axis) => {
        const meta = AXIS_META[axis];
        const barHeight = Math.max(4, (taste[axis] / 5) * height);
        const refOffset =
          reference !== undefined ? (reference[axis] / 5) * height : null;
        return (
          <div key={axis} className="flex flex-col items-center gap-1">
            <div className="relative" style={{ height, width: 9 }}>
              <div
                className="absolute bottom-0 left-0 w-full rounded-full"
                style={{ height: barHeight, background: meta.color }}
              />
              {refOffset !== null && (
                <div
                  className="absolute left-[-3px] w-[15px] border-t-2 border-dashed border-ink/45"
                  style={{ bottom: refOffset }}
                />
              )}
            </div>
            <span className="text-[10px] font-bold text-fg-muted">
              {meta.label.slice(0, 1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 접근성용 텍스트 대체. 차트는 aria-hidden이므로 이쪽이 스크린리더가 읽는다. */
export function tasteSummary(taste: TasteVector): string {
  return AXES.map((axis) => `${AXIS_META[axis].label} ${taste[axis].toFixed(1)}점`).join(", ");
}
