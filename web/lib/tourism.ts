import tourismJson from "@/public/data/tourism.json";

import type { NearbyPlace } from "./types";

/**
 * 인기 관광명소 마스터. 좌표가 있어, 거리든 식당이든 어느 지점에서도 직접
 * 거리를 재 가까운 명소를 뽑을 수 있다. 거리별로 미리 잘라 두지 않는 이유가
 * 이것 — 식당 상세에서는 6곳보다 더 넉넉히 보여 주고 싶기 때문이다.
 */
const TOURISM = tourismJson as unknown as Omit<NearbyPlace, "dist">[];

const EARTH_M = 6371000;

function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLon = (b.lon - a.lon) * p;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.sqrt(h)));
}

/**
 * 한 지점에서 가까운 관광지. dist(m)를 채워 돌려준다.
 *
 * 순수 거리순으로 자르면 관광 풀이 1,700곳이라 이름 없는 소소한 곳이 유명
 * 명소를 밀어낸다. 그래서 반경 안에서 인기명소(popularity>0)를 먼저, 그다음
 * 나머지를 거리순으로 채운다. 둘 다 그 안에서는 가까운 순이다.
 */
export function nearbyTourism(
  origin: { lat: number; lon: number },
  { radiusM = 15000, limit = 6 }: { radiusM?: number; limit?: number } = {},
): NearbyPlace[] {
  const within = TOURISM.map((t) => ({
    ...t,
    dist:
      t.lat !== null && t.lon !== null
        ? distanceM(origin, { lat: t.lat, lon: t.lon })
        : Number.POSITIVE_INFINITY,
  })).filter((t) => t.dist <= radiusM);

  const byDist = (a: NearbyPlace, b: NearbyPlace) => a.dist - b.dist;
  const popular = within.filter((t) => t.popularity > 0).sort(byDist);
  const rest = within.filter((t) => t.popularity === 0).sort(byDist);
  return [...popular, ...rest].slice(0, limit);
}
