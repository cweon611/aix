import { AXES, type Axis, type Food, type Street, type TasteVector } from "./types";

export interface Preference extends TasteVector {
  month: number;
  /** "전체"면 식사·디저트·음료를 한 줄로 세운다. 기본은 식사만. */
  course: "식사" | "디저트·음료" | "전체";
  region: "전체" | "광주" | "전남";
}

export const DEFAULT_PREFERENCE: Preference = {
  spicy: 3,
  salty: 3,
  soup: 3,
  texture: 3,
  aroma: 3,
  month: new Date().getMonth() + 1,
  course: "식사",
  region: "전체",
};

// 한 축의 최대 오차는 4점(1↔5). 다섯 축이 모두 최악이면 제곱합은 5*16 = 80.
const MAX_SQUARED_DISTANCE = AXES.length * 16;

/**
 * 사용자가 한쪽 끝으로 밀어 둔 축은 그 사람이 실제로 신경 쓰는 축이다.
 * 3(무관심)에서 멀어질수록 가중치를 올려, "국물 5"라고 말한 사람에게
 * 국물 없는 음식이 올라오지 않게 한다.
 */
function axisWeight(preferred: number): number {
  return 1 + Math.abs(preferred - 3) * 0.5;
}

export function tasteSimilarity(pref: TasteVector, taste: TasteVector): number {
  let weightedSquares = 0;
  let weightSum = 0;
  for (const axis of AXES) {
    const w = axisWeight(pref[axis]);
    const diff = pref[axis] - taste[axis];
    weightedSquares += w * diff * diff;
    weightSum += w;
  }
  // 가중 평균 제곱오차를 다시 무가중 스케일로 되돌려 0~1로 정규화한다.
  const normalized = (weightedSquares / weightSum) * AXES.length;
  return 1 - Math.sqrt(normalized / MAX_SQUARED_DISTANCE);
}

function matchesCourse(food: Food, course: Preference["course"]): boolean {
  if (course === "전체") return true;
  if (course === "식사") return food.course === "식사";
  return food.course === "디저트" || food.course === "음료";
}

function matchesRegion(food: Food, region: Preference["region"]): boolean {
  if (region === "전체") return true;
  return food.regions.some((r) => r.startsWith(region));
}

export interface ScoredFood {
  food: Food;
  /** 0~100. 취향 일치도. */
  match: number;
  /** 이번 달 제철이면 true. 인접 월로 넓혀 잡은 경우 false. */
  inSeason: boolean;
  /** 사용자 값과 가장 크게 어긋난 축 — 카드에 "다만 …" 문구로 쓴다. */
  weakestAxis: Axis | null;
}

/**
 * 제철(월) → 코스 → 지역 순으로 거르고 취향 유사도로 정렬한다.
 * 해당 월 결과가 너무 적으면 앞뒤 한 달까지 넓힌다. 제철이 아닌 것을
 * 억지로 끼워 넣기보다 "이번 달은 아니지만"이라고 밝히는 편이 정직하다.
 */
export function recommendFoods(
  foods: Food[],
  pref: Preference,
  limit = 12,
): ScoredFood[] {
  const neighbours = [
    ((pref.month + 10) % 12) + 1,
    pref.month,
    (pref.month % 12) + 1,
  ];

  const pool = foods.filter(
    (f) => matchesCourse(f, pref.course) && matchesRegion(f, pref.region),
  );

  const strict = pool.filter((f) => f.months.includes(pref.month));
  const relaxed = pool.filter((f) => f.months.some((m) => neighbours.includes(m)));
  const candidates = strict.length >= 8 ? strict : relaxed;

  const scored = candidates.map<ScoredFood>((food) => {
    const similarity = tasteSimilarity(pref, food.taste);
    // 근거가 약한 점수는 조금 깎는다. 신뢰도 0.3짜리 추측이 0.85짜리 근거를
    // 이기고 1위로 올라오면, 사용자는 이유를 납득할 수 없다.
    const credibility = 0.85 + 0.15 * food.confidence;

    let weakest: Axis | null = null;
    let worst = 0;
    for (const axis of AXES) {
      const gap = Math.abs(pref[axis] - food.taste[axis]);
      if (gap > worst) {
        worst = gap;
        weakest = axis;
      }
    }

    return {
      food,
      match: Math.round(similarity * credibility * 100),
      inSeason: food.months.includes(pref.month),
      weakestAxis: worst >= 1.5 ? weakest : null,
    };
  });

  scored.sort((a, b) => {
    if (b.match !== a.match) return b.match - a.match;
    if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
    // 같은 점수면 실제로 갈 수 있는 집이 많은 쪽을 앞에 둔다.
    return b.food.restaurantCount - a.food.restaurantCount;
  });

  return diversifyByIngredient(scored, limit);
}

/** 한 식재료가 결과를 독점하지 못하게 하는 상한. */
const MAX_PER_INGREDIENT = 2;

/**
 * 점수순 정렬만 하면 "전복문어탕·전복연포탕·전복해신탕·전복삼계탕"처럼
 * 같은 재료의 변주가 목록을 통째로 차지한다. 점수는 정직하지만 답으로는
 * 쓸모가 없다 — 사용자는 오늘 뭘 먹을지 고르려는 것이지 전복 요리 목록을
 * 보려는 게 아니다.
 *
 * 그래서 재료당 상위 2개까지만 먼저 채우고, 자리가 남으면 밀려난 것들을
 * 원래 점수 순서대로 되돌려 넣는다. 순위 자체는 바꾸지 않고 배치만 고른다.
 */
function diversifyByIngredient(scored: ScoredFood[], limit: number): ScoredFood[] {
  const taken: ScoredFood[] = [];
  const overflow: ScoredFood[] = [];
  const seen = new Map<string, number>();

  // 같은 메뉴가 재료만 다르게 두 번 들어와 있는 경우가 있다. 원본에서
  // "우렁이 쌈밥 정식, 전복들깨탕"이 들깨 행과 전복 행으로 각각 잡히는 식이다.
  // 사용자에겐 같은 요리이므로 점수가 높은 쪽 하나만 남긴다.
  const seenNames = new Set<string>();
  const deduped = scored.filter((item) => {
    if (seenNames.has(item.food.name)) return false;
    seenNames.add(item.food.name);
    return true;
  });

  for (const item of deduped) {
    const key = item.food.ingredient || item.food.name;
    const count = seen.get(key) ?? 0;
    if (count < MAX_PER_INGREDIENT && taken.length < limit) {
      taken.push(item);
      seen.set(key, count + 1);
    } else {
      overflow.push(item);
    }
  }

  // 다양성을 지키고도 자리가 남으면 점수순으로 마저 채운다.
  return taken.concat(overflow).slice(0, limit);
}

// --------------------------------------------------------------------------
// 음식 → 특화거리 매칭
// --------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface StreetMatch {
  street: Street;
  score: number;
  /** 왜 이 거리가 뽑혔는지 — 화면에 그대로 보여 준다. */
  reasons: string[];
  /** 추천 음식 식당에서 이 거리까지의 최단 거리(km). 좌표가 없으면 null. */
  distanceKm: number | null;
}

/**
 * 하나의 추천 음식에 어울리는 특화거리를 점수순으로 돌려준다.
 *
 * 점수 설계 의도: 키워드 일치가 가장 강한 신호다. "낙지"를 추천받은 사람에게
 * 무안뻘낙지거리를 보여 주는 것이, 단지 가깝다는 이유로 다른 거리를
 * 보여 주는 것보다 훨씬 쓸모 있다. 지리적 근접은 보조 신호로만 쓴다.
 */
export function matchStreets(food: Food, streets: Street[], limit = 3): StreetMatch[] {
  const foodStreets = streets.filter((s) => s.category === "음식");

  const coords = food.restaurants
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({ lat: r.lat as number, lon: r.lon as number }));

  const matches = foodStreets.map<StreetMatch>((street) => {
    const reasons: string[] = [];
    let score = 0;

    // 1) 식재료·요리 키워드 일치
    const hitKeyword = street.foodKeywords.find(
      (kw) => food.ingredient.includes(kw) || kw.includes(food.ingredient) || food.name.includes(kw),
    );
    if (hitKeyword) {
      score += 50;
      reasons.push(`${hitKeyword} 전문 거리`);
    }

    // 2) 행정구역 일치
    const sameSigungu = food.regions.some(
      (r) => street.sigungu && r.includes(street.sigungu),
    );
    const sameSido = food.regions.some((r) => r.startsWith(street.sido));
    if (sameSigungu) {
      score += 30;
      reasons.push(`${street.sigungu} 안에 있음`);
    } else if (sameSido) {
      score += 10;
    }

    // 3) 실제 식당과의 거리
    let distanceKm: number | null = null;
    if (street.lat !== null && street.lon !== null && coords.length > 0) {
      distanceKm = Math.min(
        ...coords.map((c) => haversineKm(c, { lat: street.lat as number, lon: street.lon as number })),
      );
      if (distanceKm < 5) {
        score += 20;
        reasons.push(`파는 집에서 ${distanceKm.toFixed(1)}km`);
      } else if (distanceKm < 20) {
        score += 10;
        reasons.push(`파는 집에서 ${Math.round(distanceKm)}km`);
      } else if (distanceKm < 50) {
        score += 4;
      }
    }

    // 4) 규모 — 같은 조건이면 점포가 많은 쪽이 헛걸음할 확률이 낮다.
    score += Math.min(6, Math.log10(Math.max(1, street.shopCount)) * 3);

    return { street, score, reasons, distanceKm };
  });

  return matches
    .filter((m) => m.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 추천 음식 목록 전체를 훑어 거리별 득표를 합산한다. */
export interface StreetAggregate {
  street: Street;
  score: number;
  foods: { name: string; match: number }[];
}

export function aggregateStreets(
  scored: ScoredFood[],
  streets: Street[],
  limit = 6,
): StreetAggregate[] {
  const bucket = new Map<string, StreetAggregate>();

  for (const item of scored) {
    for (const match of matchStreets(item.food, streets, 2)) {
      const existing = bucket.get(match.street.id);
      // 취향 일치도가 높은 음식이 밀어 준 거리일수록 위로 올라온다.
      const contribution = match.score * (item.match / 100);
      if (existing) {
        existing.score += contribution;
        existing.foods.push({ name: item.food.name, match: item.match });
      } else {
        bucket.set(match.street.id, {
          street: match.street,
          score: contribution,
          foods: [{ name: item.food.name, match: item.match }],
        });
      }
    }
  }

  return [...bucket.values()]
    .map((a) => ({ ...a, foods: a.foods.sort((x, y) => y.match - x.match).slice(0, 4) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --------------------------------------------------------------------------
// URL 쿼리 <-> 취향 (결과 링크를 그대로 공유할 수 있게 한다)
// --------------------------------------------------------------------------

export function preferenceToQuery(pref: Preference): string {
  const params = new URLSearchParams();
  for (const axis of AXES) params.set(axis, String(pref[axis]));
  params.set("month", String(pref.month));
  params.set("course", pref.course);
  params.set("region", pref.region);
  return params.toString();
}

export function preferenceFromQuery(
  query: Record<string, string | string[] | undefined>,
): Preference {
  const readAxis = (key: Axis): number => {
    const raw = query[key];
    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(value)) return DEFAULT_PREFERENCE[key];
    return Math.min(5, Math.max(1, Math.round(value)));
  };
  const readString = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return allowed.includes(value as T) ? (value as T) : fallback;
  };

  const rawMonth = Number(
    Array.isArray(query.month) ? query.month[0] : query.month,
  );
  const month =
    Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12
      ? Math.round(rawMonth)
      : DEFAULT_PREFERENCE.month;

  return {
    spicy: readAxis("spicy"),
    salty: readAxis("salty"),
    soup: readAxis("soup"),
    texture: readAxis("texture"),
    aroma: readAxis("aroma"),
    month,
    course: readString("course", ["식사", "디저트·음료", "전체"] as const, "식사"),
    region: readString("region", ["전체", "광주", "전남"] as const, "전체"),
  };
}
