import Link from "next/link";

import { RegionMap, type MapMarker } from "@/components/RegionMap";
import { TasteChart, tasteSummary } from "@/components/TasteChart";
import { foods, streets } from "@/lib/data";
import { streetDisplayName, withParticle } from "@/lib/korean";
import {
  aggregateStreets,
  matchStreets,
  preferenceFromQuery,
  preferenceToQuery,
  recommendFoods,
} from "@/lib/recommend";
import { AXES, AXIS_META } from "@/lib/types";

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pref = preferenceFromQuery(query);
  const scored = recommendFoods(foods, pref, 10);
  const topStreets = aggregateStreets(scored, streets, 5);

  // 지도에는 상위 거리와, 1위 음식을 파는 집들을 함께 찍는다.
  const markers: MapMarker[] = [];
  topStreets.forEach((agg, index) => {
    if (agg.street.lat !== null && agg.street.lon !== null) {
      markers.push({
        id: agg.street.id,
        lat: agg.street.lat,
        lon: agg.street.lon,
        label: agg.street.name,
        kind: "street",
        highlight: index === 0,
      });
    }
  });
  scored.slice(0, 3).forEach((item) => {
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

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      <header className="bg-ink px-6 pb-5 pt-11 text-fg-inverse">
        <Link href="/" className="text-[13px] text-[#b8afa6] hover:text-fg-inverse">
          ← 취향 다시 고르기
        </Link>
        <h1 className="font-display mt-2 text-[26px] leading-tight">
          {pref.month}월의 남도, {scored.length}가지
        </h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {AXES.map((axis) => (
            <span
              key={axis}
              className="rounded-full border px-2 py-0.5 text-[11px] font-bold"
              style={{ borderColor: AXIS_META[axis].color, color: AXIS_META[axis].color }}
            >
              {AXIS_META[axis].label} {pref[axis]}
            </span>
          ))}
          <span className="rounded-full border border-[#6b6259] px-2 py-0.5 text-[11px] text-[#b8afa6]">
            {pref.course} · {pref.region}
          </span>
        </div>
      </header>

      {scored.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="px-5 pt-4">
            <h2 className="mb-2 text-[13px] font-bold text-fg-muted">
              추천 지점 한눈에 보기
            </h2>
            <RegionMap markers={markers} height={230} />
            <p className="mt-2 text-[11px] text-fg-muted">
              <span className="font-bold text-brand">●</span> 특화거리 ·{" "}
              <span className="font-bold text-accent">●</span> 실제로 파는 집
            </p>
          </section>

          <section className="px-5 pt-6">
            <h2 className="font-display text-[20px]">취향에 맞는 제철 음식</h2>
            <ol className="mt-3 space-y-3">
              {scored.map((item, index) => {
                const best = matchStreets(item.food, streets, 1)[0];
                return (
                  <li
                    key={item.food.id}
                    className="rounded-2xl border border-line bg-surface px-4 py-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-brand">
                            {index + 1}
                          </span>
                          <h3 className="font-display truncate text-[20px]">
                            {item.food.name}
                          </h3>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.food.ingredient && (
                            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                              {item.food.ingredient}
                            </span>
                          )}
                          {item.food.regions.slice(0, 2).map((r) => (
                            <span
                              key={r}
                              className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
                            >
                              {r}
                            </span>
                          ))}
                          {!item.inSeason && (
                            <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] text-fg-muted">
                              이번 달 제철은 아님
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-center">
                        <div className="font-display text-[22px] text-brand">
                          {item.match}
                        </div>
                        <div className="text-[10px] font-bold text-fg-muted">
                          취향 일치
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <TasteChart taste={item.food.taste} reference={pref} />
                      <div className="min-w-0 text-right">
                        <p className="text-[13px] font-medium text-fg">
                          파는 곳 {item.food.restaurantCount}곳
                        </p>
                        {best && (
                          <Link
                            href={`/street/${best.street.id}?${preferenceToQuery(pref)}&food=${encodeURIComponent(item.food.id)}`}
                            className="block truncate text-[12px] text-accent hover:underline"
                          >
                            → {streetDisplayName(best.street)}
                          </Link>
                        )}
                      </div>
                    </div>

                    <p className="sr-only">맛 프로파일: {tasteSummary(item.food.taste)}</p>

                    {item.weakestAxis && (
                      <p className="mt-2 border-t border-line pt-2 text-[12px] text-fg-muted">
                        다만{" "}
                        <b>{AXIS_META[item.weakestAxis].label}</b>
                        {withParticle(AXIS_META[item.weakestAxis].label, "은/는").slice(
                          AXIS_META[item.weakestAxis].label.length,
                        )}{" "}
                        고르신 {pref[item.weakestAxis]}점보다{" "}
                        {item.food.taste[item.weakestAxis] > pref[item.weakestAxis]
                          ? "센"
                          : "약한"}{" "}
                        {item.food.taste[item.weakestAxis].toFixed(1)}점입니다.
                      </p>
                    )}

                    {item.food.confidence < 0.6 && (
                      <p className="mt-1 text-[11px] text-fg-muted">
                        ※ 메뉴명 정보가 짧아 맛 점수의 근거가 약합니다.
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
              {topStreets.map((agg) => (
                <li key={agg.street.id}>
                  <Link
                    href={`/street/${agg.street.id}?${preferenceToQuery(pref)}`}
                    className="block rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-display text-[18px]">
                        {streetDisplayName(agg.street)}
                      </h3>
                      <span className="shrink-0 text-[12px] text-fg-muted">
                        점포 {agg.street.shopCount}곳
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      {agg.street.sido} {agg.street.sigungu}
                    </p>
                    <p className="mt-1.5 text-[12px] text-accent">
                      {agg.foods.map((f) => f.name).join(" · ")}
                    </p>
                  </Link>
                </li>
              ))}
            </ol>
            {topStreets.length === 0 && (
              <p className="mt-3 rounded-2xl border border-line bg-surface-alt px-4 py-6 text-center text-[13px] text-fg-muted">
                추천된 음식과 연결되는 특화거리를 찾지 못했습니다.
                <br />
                지역을 넓히거나 취향을 조금 바꿔 보세요.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <section className="px-6 py-16 text-center">
      <p className="font-display text-[20px]">조건에 맞는 음식이 없습니다</p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
        선택한 달·지역·종류 조합에 해당하는 데이터가 없습니다.
        <br />
        지역을 &lsquo;전체&rsquo;로 바꾸거나 다른 달을 골라 보세요.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-2xl bg-brand px-6 py-3 text-[15px] font-bold text-fg-inverse"
      >
        취향 다시 고르기
      </Link>
    </section>
  );
}
