import Link from "next/link";

import { RegionMap, type MapMarker } from "@/components/RegionMap";
import { TasteBadges } from "@/components/TasteChart";
import { foods, streets } from "@/lib/data";
import { streetDisplayName } from "@/lib/korean";
import {
  aggregateStreets,
  matchStreets,
  preferenceFromQuery,
  preferenceToQuery,
  recommendFoods,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR, SPICY_LEVELS } from "@/lib/types";

/** 결과에 보여 줄 음식 개수. */
const FOOD_LIMIT = 4;

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pref = preferenceFromQuery(query);
  const scored = recommendFoods(foods, pref, FOOD_LIMIT);
  const topStreets = aggregateStreets(scored, streets, 4);

  const markers: MapMarker[] = [];
  topStreets.forEach((agg, index) => {
    if (agg.street.lat !== null && agg.street.lon !== null) {
      markers.push({
        id: agg.street.id,
        lat: agg.street.lat,
        lon: agg.street.lon,
        label: streetDisplayName(agg.street),
        kind: "street",
        highlight: index === 0,
      });
    }
  });
  scored.forEach((item) => {
    item.food.restaurants.forEach((r) => {
      if (r.lat !== null && r.lon !== null) {
        markers.push({
          id: `${item.food.id}-${r.id}`,
          lat: r.lat,
          lon: r.lon,
          label: r.name,
          kind: "restaurant",
        });
      }
    });
  });

  const spicyLabel = SPICY_LEVELS.find((l) => l.value === pref.spicy)?.label ?? "";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      <header className="bg-ink px-6 pb-5 pt-11 text-fg-inverse">
        <Link
          href="/taste"
          className="block w-fit text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
        >
          ← 취향 다시 고르기
        </Link>
        <h1 className="font-display mt-2 text-[26px] leading-tight">
          {pref.month}월의 남도, {scored.length}가지
        </h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip color={SPICY_COLOR} label={`맵기 ${spicyLabel}`} />
          <Chip
            color={SOUP_COLOR}
            label={
              pref.soup === 2 ? "국물 있게" : pref.soup === 0 ? "국물 없이" : "국물 상관없음"
            }
          />
          <Chip color={RAW_COLOR} label={pref.raw === "O" ? "날것도 좋아요" : "익힌 것으로"} />
          <Chip
            color={
              pref.ingredient === "상관없음"
                ? "#b8afa6"
                : CATEGORY_META[pref.ingredient].color
            }
            label={pref.ingredient === "상관없음" ? "주재료 상관없음" : pref.ingredient}
          />
        </div>
      </header>

      {scored.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="px-5 pt-4">
            <h2 className="mb-2 text-[13px] font-bold text-fg-muted">추천 지점 한눈에 보기</h2>
            <RegionMap markers={markers} height={220} />
            <p className="mt-2 text-[11px] text-fg-muted">
              <span className="font-bold text-brand">●</span> 특화거리 ·{" "}
              <span className="font-bold text-accent">●</span> 실제로 파는 집
            </p>
          </section>

          <section className="px-5 pt-6">
            <h2 className="font-display text-[20px]">취향에 맞는 남도 음식</h2>
            <ol className="mt-3 space-y-3">
              {scored.map((item, index) => {
                const best = matchStreets(item.food, streets, 1)[0];
                return (
                  <li
                    key={item.food.id}
                    className="result-card rounded-2xl border border-line bg-surface px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-brand">{index + 1}</span>
                          <h3 className="font-display truncate text-[21px]">{item.food.name}</h3>
                        </div>
                        <p className="mt-1 text-[12px] text-fg-muted">
                          {item.food.ingredient && `${item.food.ingredient} · `}
                          {item.food.regions.slice(0, 2).join(", ")}
                          {!item.inSeason && " · 이번 달 제철은 아님"}
                        </p>
                      </div>
                      <div className="shrink-0 text-center">
                        <div className="font-display text-[24px] text-brand">{item.match}</div>
                        <div className="text-[10px] font-bold text-fg-muted">취향 일치</div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <TasteBadges food={item.food} />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                      <p className="text-[13px] font-medium text-fg">
                        파는 곳 {item.food.restaurantCount}곳
                      </p>
                      {best && (
                        <Link
                          href={`/street/${best.street.id}?${preferenceToQuery(pref)}`}
                          className="min-w-0 truncate text-[13px] text-accent transition-colors hover:text-brand hover:underline"
                        >
                          → {streetDisplayName(best.street)}
                        </Link>
                      )}
                    </div>

                    {item.mismatches.length > 0 && (
                      <p className="mt-2 text-[12px] text-fg-muted">
                        다만 {item.mismatches.join(", ")}.
                      </p>
                    )}

                    {item.food.confidence < 0.6 && (
                      <p className="mt-1 text-[11px] text-fg-muted">
                        ※ 메뉴명 정보가 짧아 지표의 근거가 약합니다.
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="px-5 pt-7">
            <h2 className="font-display text-[20px]">가 볼 만한 특화거리</h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              위 음식들이 실제로 모여 있는 거리를 득표순으로 모았습니다.
            </p>
            <ol className="mt-3 space-y-2.5">
              {topStreets.map((agg, index) => (
                <li key={agg.street.id}>
                  <Link
                    href={`/street/${agg.street.id}?${preferenceToQuery(pref)}`}
                    className="street-card flex items-center gap-3 rounded-2xl border-y border-r border-line bg-surface px-4 py-3.5"
                  >
                    <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[16px] text-brand">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-display truncate text-[18px]">
                          {streetDisplayName(agg.street)}
                        </h3>
                        <span className="shrink-0 text-[12px] text-fg-muted">
                          점포 {agg.street.shopCount}곳
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-fg-muted">
                        {agg.street.sido} {agg.street.sigungu}
                      </p>
                      <p className="mt-1.5 truncate text-[12px] text-accent">
                        {agg.foods.map((f) => f.name).join(" · ")}
                      </p>
                    </div>
                    <span
                      className="street-card-arrow shrink-0 text-[20px] text-fg-muted"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {topStreets.length === 0 && (
              <p className="mt-3 rounded-2xl border border-line bg-surface-alt px-4 py-6 text-center text-[13px] text-fg-muted">
                추천된 음식과 연결되는 특화거리를 찾지 못했습니다.
                <br />
                취향을 조금 바꿔 보세요.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-bold"
      style={{ borderColor: color, color }}
    >
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <section className="px-6 py-16 text-center">
      <p className="font-display text-[20px]">조건에 맞는 음식이 없습니다</p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
        선택한 달·종류 조합에 해당하는 데이터가 없습니다.
        <br />
        다른 달을 골라 보세요.
      </p>
      <Link
        href="/taste"
        className="mt-6 inline-block rounded-2xl bg-brand px-6 py-3 text-[15px] font-bold text-fg-inverse transition-all hover:-translate-y-0.5 hover:shadow-lg"
      >
        취향 다시 고르기
      </Link>
    </section>
  );
}
