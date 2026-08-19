import Link from "next/link";
import { notFound } from "next/navigation";

import { type MapMarker } from "@/components/RegionMap";
import { StreetMapPanel } from "@/components/StreetMapPanel";
import { allRestaurants, findRestaurant, restaurantIds } from "@/lib/data";
import { haversineKm, preferenceFromQuery, preferenceToQuery } from "@/lib/recommend";
import { nearbyTourism } from "@/lib/tourism";

// 식당 상세는 지도에서 핀을 눌러 들어온다. 관광명소는 6곳보다 넉넉히.
const TOURISM_LIMIT = 12;
const NEARBY_SHOP_LIMIT = 6;

export function generateStaticParams() {
  return restaurantIds().map((id) => ({ id }));
}

export default async function RestaurantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const entry = findRestaurant(id);
  if (!entry) notFound();

  const { restaurant: shop, foods } = entry;
  const pref = preferenceFromQuery(await searchParams);
  const origin = { lat: shop.lat as number, lon: shop.lon as number };

  const tourism = nearbyTourism(origin, { radiusM: 30000, limit: TOURISM_LIMIT });

  // 가까운 다른 맛집. 자기 자신과 같은 좌표(같은 집의 다른 레코드)는 뺀다.
  const nearbyShops = allRestaurants()
    .filter((e) => e.restaurant.id !== shop.id)
    .map((e) => ({ ...e, km: haversineKm(origin, { lat: e.restaurant.lat as number, lon: e.restaurant.lon as number }) }))
    .filter((e) => e.km > 0.02)
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_SHOP_LIMIT);

  const markers: MapMarker[] = [
    { id: shop.id, lat: origin.lat, lon: origin.lon, label: shop.name, kind: "restaurant", highlight: true },
    ...nearbyShops.map((e) => ({
      id: e.restaurant.id,
      lat: e.restaurant.lat as number,
      lon: e.restaurant.lon as number,
      label: e.restaurant.name,
      kind: "restaurant" as const,
    })),
  ];

  const q = preferenceToQuery(pref);
  const kakao = (text: string) =>
    `https://map.kakao.com/link/search/${encodeURIComponent(text)}`;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      <header className="bg-ink px-5 py-3 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/result?${q}`}
            className="shrink-0 text-[13px] text-[#b8afa6] hover:text-fg-inverse"
          >
            ← 추천 목록
          </Link>
          <h1 className="font-display truncate text-[16px]">{shop.name}</h1>
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent">
            {shop.area}
          </span>
        </div>
      </header>

      <StreetMapPanel baseMarkers={markers} nearby={tourism} />

      <section className="px-5 pt-3">
        <p className="text-[13px] text-fg-muted">
          {shop.address || `${shop.region} ${shop.area}`}
          {shop.isLocalSpecialty && (
            <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">
              향토음식점
            </span>
          )}
        </p>
      </section>

      <section className="px-5 pt-6">
        <h2 className="font-display text-[20px]">여기서 파는 제철 음식</h2>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {foods.map((f) => (
            <li
              key={f.id}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-fg"
            >
              {f.name}
              <span className="text-fg-muted"> · {f.ingredient}</span>
            </li>
          ))}
        </ul>
      </section>

      {nearbyShops.length > 0 && (
        <section className="px-5 pt-6">
          <h2 className="font-display text-[20px]">가까운 다른 맛집</h2>
          <p className="mt-1 text-[12px] text-fg-muted">
            이 집에서 가까운 순입니다. 무엇을 파는지 함께 적었습니다.
          </p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {nearbyShops.map((e) => (
              <li key={e.restaurant.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/restaurant/${e.restaurant.id}?${q}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-fg">
                      {e.restaurant.name}
                    </span>
                    {e.restaurant.isLocalSpecialty && (
                      <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">
                        향토
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-fg-muted">
                    {e.restaurant.area} · {e.foods.map((food) => food.name).slice(0, 3).join(" · ")}
                  </p>
                </Link>
                <span className="shrink-0 text-[12px] text-fg-muted">
                  {e.km < 1 ? `${Math.round(e.km * 1000)}m` : `${e.km.toFixed(1)}km`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="px-5 pt-6">
        <a
          href={kakao(shop.address || shop.name)}
          target="_blank"
          rel="noreferrer"
          className="block rounded-2xl bg-ink py-4 text-center text-[16px] font-bold text-fg-inverse"
        >
          지도에서 이 식당 열기
        </a>
      </section>

      <footer className="px-6 pt-6 text-[11px] leading-relaxed text-fg-muted">
        <p>식당 정보 한국관광공사 TourAPI · 주변 명소는 전남 인기 관광명소</p>
      </footer>
    </main>
  );
}
