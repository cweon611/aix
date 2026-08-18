"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OptionGroup } from "@/components/OptionGroup";
import { SpicyPicker } from "@/components/SpicyPicker";
import { EXAMPLE_PHRASES, parseTasteText, type ParsedHit } from "@/lib/parse-taste";
import {
  DEFAULT_PREFERENCE,
  INGREDIENT_OPTIONS,
  RAW_OPTIONS,
  SOUP_OPTIONS,
  preferenceToQuery,
  type IngredientPreference,
  type Preference,
  type RawPreference,
  type SoupPreference,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, type Category } from "@/lib/types";

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
  const [text, setText] = useState("");
  // null이면 아직 안 눌렀다는 뜻. 빈 배열(못 알아들음)과 구별해야 한다.
  const [hits, setHits] = useState<ParsedHit[] | null>(null);

  const submit = () => {
    setPending(true);
    router.push(`/result?${preferenceToQuery(pref)}`);
  };

  /**
   * 읽어 낸 축만 덮어쓴다. 못 읽은 축까지 기본값으로 되돌리면, 아래에서
   * 손으로 맞춰 둔 것이 한 줄 입력에 지워진다.
   */
  const applyText = () => {
    const { pref: parsed, hits: found } = parseTasteText(text);
    setHits(found);
    if (found.length > 0) setPref((p) => ({ ...p, ...parsed }));
  };

  return (
    <div className="px-6 py-5">
      <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-4">
        <label htmlFor="taste-text" className="block text-[14px] font-bold text-accent">
          말로 적어도 됩니다
        </label>
        <p className="mt-1 text-[12px] leading-relaxed text-fg">
          먹고 싶은 걸 한 줄로 적으면 아래 항목을 대신 맞춰 드립니다. 맞춘 뒤에도 손으로
          고치실 수 있습니다.
        </p>
        <div className="mt-2.5 flex gap-2">
          <input
            id="taste-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyText();
            }}
            placeholder="예: 매콤한 국물 요리"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={applyText}
            disabled={!text.trim()}
            className="shrink-0 cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-[14px] font-bold text-fg-inverse transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            맞추기
          </button>
        </div>

        {hits !== null &&
          (hits.length > 0 ? (
            <div className="mt-2.5" role="status">
              <p className="text-[12px] font-bold text-fg">이렇게 읽었습니다</p>
              <ul className="mt-1 space-y-0.5 text-[12px] leading-relaxed text-fg">
                {hits.map((h) => (
                  <li key={h.axis}>
                    · <b className="font-bold">‘{h.phrase}’</b> → {h.label} {h.reading}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-fg-muted">
                읽지 못한 항목은 그대로 두었습니다. 아래에서 확인해 주세요.
              </p>
            </div>
          ) : (
            <div className="mt-2.5" role="status">
              <p className="text-[12px] font-bold text-brand">이 문장은 알아듣지 못했습니다</p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg">
                맵기·국물·날것·주재료·달만 알아듣습니다. 이렇게 적어 보세요.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {EXAMPLE_PHRASES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setText(ex)}
                    className="cursor-pointer rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-fg transition-colors hover:border-accent hover:text-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>

      <div className="space-y-5 rounded-2xl border border-line bg-surface px-4 py-5">
        <SpicyPicker
          value={pref.spicy}
          onChange={(spicy) => setPref((p) => ({ ...p, spicy }))}
        />

        <OptionGroup<SoupPreference>
          legend="국물"
          columns={3}
          value={pref.soup}
          onChange={(soup) => setPref((p) => ({ ...p, soup }))}
          options={SOUP_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            color: SOUP_COLOR,
          }))}
        />

        <OptionGroup<RawPreference>
          legend="날것"
          columns={2}
          value={pref.raw}
          onChange={(raw) => setPref((p) => ({ ...p, raw }))}
          options={RAW_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            color: RAW_COLOR,
          }))}
        />

        <OptionGroup<IngredientPreference>
          legend="주재료"
          columns={2}
          value={pref.ingredient}
          onChange={(ingredient) => setPref((p) => ({ ...p, ingredient }))}
          options={INGREDIENT_OPTIONS.map((option) => ({
            value: option,
            label: option,
            icon: option === "상관없음" ? undefined : CATEGORY_META[option as Category].icon,
            color:
              option === "상관없음" ? undefined : CATEGORY_META[option as Category].color,
          }))}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface-alt px-4 py-5">
        <OptionGroup<string>
          legend="언제 드실 건가요"
          columns={6}
          value={monthNames[pref.month - 1]}
          onChange={(name) =>
            setPref((p) => ({ ...p, month: monthNames.indexOf(name) + 1 }))
          }
          options={monthNames.map((name) => ({ value: name, label: name }))}
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-5 w-full cursor-pointer rounded-2xl bg-brand py-4 text-[17px] font-bold text-fg-inverse transition-all duration-150 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-lg active:translate-y-0 disabled:opacity-60"
      >
        {pending ? "찾는 중…" : "내 취향에 맞는 남도 음식 찾기"}
      </button>
    </div>
  );
}
