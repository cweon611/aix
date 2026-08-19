import Link from "next/link";

import { FoodRecommendations } from "@/components/FoodRecommendations";
import { type MapMarker } from "@/components/RegionMap";
import { foods, streets } from "@/lib/data";
import { streetDisplayName, withParticle } from "@/lib/korean";
import {
  aggregateStreets,
  foodsWithoutStreet,
  preferenceFromQuery,
  preferenceToQuery,
  randomSeed,
  rankCandidates,
  substitutionNotice,
  toNearbyCandidates,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR, SPICY_LEVELS } from "@/lib/types";

/** 결과에 보여 줄 음식 개수. */
const FOOD_LIMIT = 4;

// 매번 다르게 뽑으므로 캐시에 걸리면 안 된다. 캐시된 응답을 다시 주면
// 새로고침해도 같은 상이 나와, 다르게 나오게 한 뜻이 사라진다.
export const dynamic = "force-dynamic";

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pref = preferenceFromQuery(query);

  // 제철 후보를 전부 취향순으로 세워 클라이언트로 넘긴다. 상위 몇 개만
  // 넘기면 "가까운 순"이 취향으로 한 번 거른 뒤의 순서가 되어 버린다.
  // 씨앗이 주소에 실려 오면 그것을 쓰고, 없으면 새로 뽑는다. 그냥 들어오면
  // 매번 다른 상을 받고, 공유받은 링크로 들어오면 보낸 사람과 같은 상을 본다.
  const shared = typeof query.seed === "string" ? query.seed : "";
  const seed = shared || randomSeed();
  const ranked = rankCandidates(foods, pref, seed);
  const candidates = toNearbyCandidates(ranked, streets, FOOD_LIMIT);
  const shown = ranked.slice(0, FOOD_LIMIT);
  const topStreets = aggregateStreets(shown, streets, 4);
  // 특화거리는 광주·전남에 20곳뿐이라 추천 음식 대부분은 짝이 없다. 없는 쪽은
  // 억지로 거리를 붙이지 않고 그 음식을 파는 집으로 안내한다.
  const shopOnly = foodsWithoutStreet(shown, streets, 3);
  // 조건을 그대로 만족하는 음식이 없으면 목록 위에서 먼저 밝힌다. 카드마다
  // "다만 ~"으로만 흘리면 네 장을 다 펼쳐 봐야 알 수 있다.
  const notice = substitutionNotice(ranked, pref);

  // 특화거리 마커는 취향 기준으로 고정한다. 아래 "가 볼 만한 특화거리"
  // 절과 같은 목록이어야 지도와 목록이 서로를 설명한다.
  const streetMarkers: MapMarker[] = topStreets
    .filter((agg) => agg.street.lat !== null && agg.street.lon !== null)
    .map((agg, index) => ({
      id: agg.street.id,
      lat: agg.street.lat as number,
      lon: agg.street.lon as number,
      label: streetDisplayName(agg.street),
      kind: "street" as const,
      highlight: index === 0,
    }));

  const spicyLabel = SPICY_LEVELS.find((l) => l.value === pref.spicy)?.label ?? "";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      <header className="bg-ink px-6 pb-5 pt-11 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/taste"
            className="block w-fit text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
          >
            ← 취향 다시 고르기
          </Link>
          <Link
            href="/how"
            className="shrink-0 rounded-full border border-[#4a423a] px-2.5 py-1 text-[11px] font-bold text-[#b8afa6] transition-colors hover:border-fg-inverse hover:text-fg-inverse"
          >
            추천 방식
          </Link>
        </div>
        <h1 className="font-display mt-2 text-[26px] leading-tight">
          {pref.month}월의 남도, {Math.min(ranked.length, FOOD_LIMIT)}가지
        </h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[#b8afa6]">
          {pref.month}월 제철 후보 {ranked.length}가지를 아래 취향으로 채점했습니다. 카드마다
          <b className="font-bold text-fg-inverse"> ‘왜 이 음식인가요?’</b>를 펼치면 점수가
          어떻게 나왔는지 볼 수 있습니다.
        </p>
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

      {ranked.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {(notice.substituted || notice.outOfSeasonOnly) && (
            <SubstitutionBanner
              month={pref.month}
              substituted={notice.substituted}
              unmet={notice.unmet}
            />
          )}

          <FoodRecommendations
            candidates={candidates}
            streetMarkers={streetMarkers}
            pref={pref}
            prefQuery={preferenceToQuery(pref)}
            seed={seed}
            limit={FOOD_LIMIT}
          />

          {topStreets.length > 0 && (
          <section className="px-5 pt-7">
            <h2 className="font-display text-[20px]">가 볼 만한 특화거리</h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              추천 음식을 <b className="font-bold text-fg">대표 먹거리로 내건</b> 거리만
              모았습니다. 가깝다는 이유만으로는 넣지 않습니다.
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
                        {agg.street.shopCount > 0 && (
                          <span className="shrink-0 text-[12px] text-fg-muted">
                            점포 {agg.street.shopCount}곳
                          </span>
                        )}
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
          </section>
          )}

          {shopOnly.length > 0 && (
            <section className="px-5 pt-7">
              <h2 className="font-display text-[20px]">파는 집으로 바로 가기</h2>
              <p className="mt-1 text-[12px] text-fg-muted">
                {topStreets.length > 0 ? "나머지 추천은" : "이번 추천은"} 짝이 되는 특화거리가
                없습니다. 그 음식을 실제로 파는 집을 대신 찾았습니다.
              </p>
              <div className="mt-3 space-y-3">
                {shopOnly.map((entry) => (
                  <div
                    key={entry.food.id}
                    className="overflow-hidden rounded-2xl border border-line bg-surface"
                  >
                    <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
                      <h3 className="font-display truncate text-[17px]">{entry.food.name}</h3>
                      <span className="shrink-0 text-[12px] text-fg-muted">
                        파는 곳 {entry.food.restaurantCount}곳
                      </span>
                    </div>
                    <ul className="divide-y divide-line">
                      {entry.shops.map((shop) => (
                        <li key={shop.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[14px] font-medium text-fg">
                                {shop.name}
                              </span>
                              {shop.isLocalSpecialty && (
                                <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">
                                  향토
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[12px] text-fg-muted">
                              {shop.region} {shop.area}
                            </p>
                          </div>
                          <a
                            href={`https://map.kakao.com/link/search/${encodeURIComponent(
                              shop.address || shop.name,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-[12px] text-accent hover:underline"
                          >
                            길찾기
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/**
 * 조건에 맞는 음식이 없을 때 목록 위에 세우는 알림.
 *
 * 점수만 보면 "취향 일치 98"이라 조건을 다 맞춘 것처럼 읽힌다. 그 점수는
 * "상관없음"을 뺀 나머지 배점의 비율이라 조건이 어긋나도 높게 나온다. 그래서
 * 대체 추천이라는 사실을 목록보다 먼저, 못 맞춘 조건까지 짚어서 밝힌다.
 */
function SubstitutionBanner({
  month,
  substituted,
  unmet,
}: {
  month: number;
  substituted: boolean;
  unmet: string[];
}) {
  return (
    <section className="px-5 pt-4">
      <div
        role="alert"
        className="overflow-hidden rounded-2xl border-2 border-brand bg-surface"
      >
        <div className="flex items-start gap-2.5 bg-brand px-4 py-3">
          <span aria-hidden="true" className="text-[20px] leading-none">
            ⚠️
          </span>
          <div className="min-w-0">
            <p className="font-display text-[19px] leading-tight text-fg-inverse">
              대체 추천입니다
            </p>
            <p className="mt-1 text-[13px] font-bold leading-snug text-fg-inverse">
              {substituted
                ? "고른 조건에 맞는 음식이 없습니다"
                : `${month}월 제철 중에는 조건에 맞는 음식이 없습니다`}
            </p>
          </div>
        </div>
        <p className="px-4 py-3 text-[12px] leading-relaxed text-fg">
          {substituted ? (
            <>
              {month}월 후보 중 <b className="font-bold">조건을 모두 만족하는 음식이 하나도 없어</b>,
              아래는 조건에 <b className="font-bold">가장 가까운 음식</b>을 대신 고른 것입니다.
              {unmet.length > 0 && (
                <>
                  {" "}
                  특히 <b className="font-bold text-brand">{unmet.join("·")}</b>
                  {withParticle(unmet[unmet.length - 1], "은/는").slice(-1)} 어떤 후보도
                  맞추지 못했습니다.
                </>
              )}{" "}
              카드의 <b className="font-bold text-brand">대체 추천</b> 표시와 ‘다만 …’ 줄에서
              어느 조건이 어긋났는지 확인하실 수 있습니다.
            </>
          ) : (
            <>
              조건에 맞는 음식은 있으나 {month}월 제철이 아닙니다. 앞뒤 한 달의 제철까지
              넓혀 <b className="font-bold">대신 추천</b>합니다.
            </>
          )}
        </p>
      </div>
    </section>
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
