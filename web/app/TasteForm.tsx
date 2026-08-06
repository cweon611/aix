"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { TasteSlider } from "@/components/TasteSlider";
import { DEFAULT_PREFERENCE, preferenceToQuery, type Preference } from "@/lib/recommend";
import { AXES } from "@/lib/types";

const COURSES: Preference["course"][] = ["식사", "디저트·음료", "전체"];
const REGIONS: Preference["region"][] = ["전체", "광주", "전남"];

export function TasteForm({
  defaultMonth,
  monthNames,
}: {
  defaultMonth: number;
  monthNames: string[];
}) {
  const router = useRouter();
  const [pref, setPref] = useState<Preference>({
    ...DEFAULT_PREFERENCE,
    month: defaultMonth,
  });
  const [pending, setPending] = useState(false);

  const submit = () => {
    setPending(true);
    router.push(`/result?${preferenceToQuery(pref)}`);
  };

  return (
    <div className="px-6 py-5">
      <div className="space-y-2.5">
        {AXES.map((axis) => (
          <TasteSlider
            key={axis}
            axis={axis}
            value={pref[axis]}
            onChange={(next) => setPref((p) => ({ ...p, [axis]: next }))}
          />
        ))}
      </div>

      <div className="mt-5 space-y-4 rounded-2xl border border-line bg-surface-alt px-4 py-4">
        <Choice
          label="언제 드실 건가요"
          value={monthNames[pref.month - 1]}
          options={monthNames}
          onSelect={(name) =>
            setPref((p) => ({ ...p, month: monthNames.indexOf(name) + 1 }))
          }
          compact
        />
        <Choice
          label="무엇을 찾고 계신가요"
          value={pref.course}
          options={COURSES}
          onSelect={(course) =>
            setPref((p) => ({ ...p, course: course as Preference["course"] }))
          }
        />
        <Choice
          label="어느 지역인가요"
          value={pref.region}
          options={REGIONS}
          onSelect={(region) =>
            setPref((p) => ({ ...p, region: region as Preference["region"] }))
          }
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-5 w-full rounded-2xl bg-brand py-4 text-[17px] font-bold text-fg-inverse transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "찾는 중…" : "내 취향에 맞는 제철 음식 찾기"}
      </button>
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onSelect,
  compact = false,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold text-fg">{label}</legend>
      <div className={compact ? "grid grid-cols-6 gap-1.5" : "flex gap-1.5"}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(option)}
              className={[
                "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                compact ? "px-0 text-center" : "",
                selected
                  ? "border-ink bg-ink font-bold text-fg-inverse"
                  : "border-line bg-surface text-fg-muted hover:border-line-strong",
              ].join(" ")}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
