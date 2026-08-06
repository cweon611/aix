"use client";

import { AXIS_META, type Axis } from "@/lib/types";

/**
 * 1~5 취향 슬라이더 한 줄.
 *
 * 트랙은 선택값까지 축 색으로 채우고 나머지는 회색으로 두는 그라디언트다.
 * 값이 어디쯤인지 손잡이 위치뿐 아니라 채워진 길이로도 읽히게 하려는 것이다.
 */
export function TasteSlider({
  axis,
  value,
  onChange,
}: {
  axis: Axis;
  value: number;
  onChange: (next: number) => void;
}) {
  const meta = AXIS_META[axis];
  const filled = ((value - 1) / 4) * 100;

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={`taste-${axis}`}
          className="text-[17px] font-bold text-fg"
        >
          {meta.label}
        </label>
        <span
          className="rounded-full px-2.5 py-0.5 text-sm font-bold text-fg-inverse"
          style={{ background: meta.color }}
        >
          {value}
        </span>
      </div>

      <input
        id={`taste-${axis}`}
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="taste-range mt-1"
        style={
          {
            "--axis-color": meta.color,
            "--track-bg": `linear-gradient(to right, ${meta.color} ${filled}%, #e4daca ${filled}%)`,
          } as React.CSSProperties
        }
        aria-valuetext={`${meta.label} ${value}점 (1은 ${meta.low}, 5는 ${meta.high})`}
      />

      <div className="flex justify-between text-xs text-fg-muted">
        <span>{meta.low}</span>
        <span>{meta.high}</span>
      </div>
    </div>
  );
}
