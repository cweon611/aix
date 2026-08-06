import { CATEGORIES, type Category, type Food, type Street } from "./types";

/** 국물 선호. 1은 "상관없음"이라 점수에 영향을 주지 않는다. */
export type SoupPreference = 0 | 1 | 2;
/** 날것 선호. O는 날것을 원함, X는 익힌 것을 원함. */
export type RawPreference = "O" | "X";
/** 주재료 선호. "상관없음"이면 점수에 영향을 주지 않는다. */
export type IngredientPreference = Category | "상관없음";

export interface Preference {
  /** 0 안 매움 ~ 3 아주 매움 */
  spicy: number;
  soup: SoupPreference;
  raw: RawPreference;
  ingredient: IngredientPreference;
  month: number;
  course: "식사" | "음료" | "전체";
}

export const DEFAULT_PREFERENCE: Preference = {
  spicy: 1,
  soup: 1,
  raw: "X",
  ingredient: "상관없음",
  month: new Date().getMonth() + 1,
  course: "식사",
};

export const SOUP_OPTIONS: { value: SoupPreference; label: string }[] = [
  { value: 0, label: "국물 없이" },
  { value: 1, label: "상관없음" },
  { value: 2, label: "국물 있게" },
];

export const RAW_OPTIONS: { value: RawPreference; label: string }[] = [
  { value: "O", label: "날것도 좋아요" },
  { value: "X", label: "익힌 것으로" },
];

export const INGREDIENT_OPTIONS: IngredientPreference[] = [...CATEGORIES, "상관없음"];

// --------------------------------------------------------------------------
// 취향 일치도
// --------------------------------------------------------------------------

// 지표별 배점. 합이 100이 되게 두어 화면의 "취향 일치 87" 이 곧 백분율이다.
const WEIGHT_SPICY = 30;
const WEIGHT_SOUP = 25;
const WEIGHT_RAW = 20;
const WEIGHT_INGREDIENT = 25;

/**
 * 지표 네 가지를 각각 0~1로 채점해 가중 합한다.
 *
 * "상관없음"을 고른 지표는 배점 자체를 빼서, 신경 안 쓴 항목이 점수를
 * 끌어내리지도 올리지도 않게 한다. 그래야 모두 "상관없음"으로 두었을 때
 * 남는 지표만으로 순위가 갈린다.
 */
export function preferenceMatch(pref: Preference, food: Food): number {
  let earned = 0;
  let total = 0;

  // 맵기 — 0~3에서 얼마나 어긋났는지. 3칸 차이면 0점.
  total += WEIGHT_SPICY;
  earned += WEIGHT_SPICY * (1 - Math.abs(pref.spicy - food.spicy) / 3);

  // 국물 — 상관없음(1)이면 채점하지 않는다.
  if (pref.soup !== 1) {
    total += WEIGHT_SOUP;
    const wantsSoup = pref.soup === 2;
    if (wantsSoup === food.hasSoup) earned += WEIGHT_SOUP;
  }

  // 날것 — O는 날것을 원하고 X는 익힌 것을 원한다.
  total += WEIGHT_RAW;
  const wantsRaw = pref.raw === "O";
  if (wantsRaw === food.isRaw) {
    earned += WEIGHT_RAW;
  } else if (wantsRaw) {
    // 날것을 원했는데 익힌 것이면 아깝다. 반대(익힌 걸 원했는데 날것)보다는
    // 덜 치명적이라 절반만 깎는다 — 날것 메뉴 자체가 적기 때문이다.
    earned += WEIGHT_RAW * 0.4;
  }

  // 주재료 — 상관없음이면 채점하지 않는다.
  if (pref.ingredient !== "상관없음") {
    total += WEIGHT_INGREDIENT;
    if (food.mainIngredients.includes(pref.ingredient)) {
      earned += WEIGHT_INGREDIENT;
    }
  }

  if (total === 0) return 0;
  return (earned / total) * 100;
}

export interface ScoredFood {
  food: Food;
  /** 0~100. 취향 일치도. */
  match: number;
  /** 이번 달 제철이면 true. 인접 월로 넓혀 잡은 경우 false. */
  inSeason: boolean;
  /** 사용자 선택과 어긋난 지표들 — 카드에 "다만 …" 문구로 쓴다. */
  mismatches: string[];
}

function describeMismatches(pref: Preference, food: Food): string[] {
  const notes: string[] = [];

  const gap = Math.abs(pref.spicy - food.spicy);
  if (gap >= 2) {
    notes.push(food.spicy > pref.spicy ? "고른 것보다 맵습니다" : "고른 것보다 덜 맵습니다");
  }
  if (pref.soup === 2 && !food.hasSoup) notes.push("국물 요리는 아닙니다");
  if (pref.soup === 0 && food.hasSoup) notes.push("국물이 있는 요리입니다");
  if (pref.raw === "O" && !food.isRaw) notes.push("날것은 아닙니다");
  if (pref.raw === "X" && food.isRaw) notes.push("날것으로 먹습니다");
  if (pref.ingredient !== "상관없음" && !food.mainIngredients.includes(pref.ingredient)) {
    notes.push(`주재료가 ${food.mainIngredients.join("·") || "분류 없음"}입니다`);
  }
  return notes;
}

function matchesCourse(food: Food, course: Preference["course"]): boolean {
  if (course === "전체") return true;
  return food.course === course;
}

/**
 * 제철(월) → 코스 순으로 거르고 취향 일치도로 정렬한다.
 * 해당 월 결과가 너무 적으면 앞뒤 한 달까지 넓힌다. 제철이 아닌 것을
 * 억지로 끼워 넣기보다 "이번 달은 아니지만"이라고 밝히는 편이 정직하다.
 */
export function recommendFoods(foods: Food[], pref: Preference, limit = 4): ScoredFood[] {
  const neighbours = [((pref.month + 10) % 12) + 1, pref.month, (pref.month % 12) + 1];

  const pool = foods.filter((f) => matchesCourse(f, pref.course));
  const strict = pool.filter((f) => f.months.includes(pref.month));
  const relaxed = pool.filter((f) => f.months.some((m) => neighbours.includes(m)));
  const candidates = strict.length >= 8 ? strict : relaxed;

  const scored = candidates.map<ScoredFood>((food) => {
    // 근거가 약한 지표가 근거 있는 지표를 이기고 1위에 오르면 납득할 수 없다.
    const credibility = 0.85 + 0.15 * food.confidence;
    return {
      food,
      match: Math.round(preferenceMatch(pref, food) * credibility),
      inSeason: food.months.includes(pref.month),
      mismatches: describeMismatches(pref, food),
    };
  });

  scored.sort((a, b) => {
    if (b.match !== a.match) return b.match - a.match;
    if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
    // 같은 점수면 실제로 갈 수 있는 집이 많은 쪽을 앞에 둔다.
    return b.food.restaurantCount - a.food.restaurantCount;
  });

  return diversify(scored, limit);
}

/** 한 식재료가 결과를 독점하지 못하게 하는 상한. */
const MAX_PER_INGREDIENT = 2;

/**
 * 점수순 정렬만 하면 "전복문어탕·전복연포탕·전복해신탕"처럼 같은 재료의
 * 변주가 목록을 통째로 차지한다. 점수는 정직하지만 답으로는 쓸모가 없다 —
 * 사용자는 오늘 뭘 먹을지 고르려는 것이지 전복 요리 목록을 보려는 게 아니다.
 */
function diversify(scored: ScoredFood[], limit: number): ScoredFood[] {
  // 같은 메뉴가 재료만 다르게 두 번 들어와 있는 경우가 있다. 원본에서
  // "우렁이 쌈밥 정식, 전복들깨탕"이 들깨 행과 전복 행으로 각각 잡히는 식이다.
  const seenNames = new Set<string>();
  const deduped = scored.filter((item) => {
    if (seenNames.has(item.food.name)) return false;
    seenNames.add(item.food.name);
    return true;
  });

  const taken: ScoredFood[] = [];
  const overflow: ScoredFood[] = [];
  const seen = new Map<string, number>();

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
  reasons: string[];
  distanceKm: number | null;
}

/**
 * 하나의 추천 음식에 어울리는 특화거리를 점수순으로 돌려준다.
 *
 * 키워드 일치가 가장 강한 신호다. "낙지"를 추천받은 사람에게 무안뻘낙지거리를
 * 보여 주는 것이, 단지 가깝다는 이유로 다른 거리를 보여 주는 것보다 쓸모 있다.
 */
export function matchStreets(food: Food, streets: Street[], limit = 3): StreetMatch[] {
  const foodStreets = streets.filter((s) => s.category === "음식");
  const coords = food.restaurants
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({ lat: r.lat as number, lon: r.lon as number }));

  const matches = foodStreets.map<StreetMatch>((street) => {
    const reasons: string[] = [];
    let score = 0;

    const hitKeyword = street.foodKeywords.find(
      (kw) =>
        food.ingredient.includes(kw) || kw.includes(food.ingredient) || food.name.includes(kw),
    );
    if (hitKeyword) {
      score += 50;
      reasons.push(`${hitKeyword} 전문 거리`);
    }

    const sameSigungu = food.regions.some((r) => street.sigungu && r.includes(street.sigungu));
    const sameSido = food.regions.some((r) => r.startsWith(street.sido));
    if (sameSigungu) {
      score += 30;
      reasons.push(`${street.sigungu} 안에 있음`);
    } else if (sameSido) {
      score += 10;
    }

    let distanceKm: number | null = null;
    if (street.lat !== null && street.lon !== null && coords.length > 0) {
      distanceKm = Math.min(
        ...coords.map((c) =>
          haversineKm(c, { lat: street.lat as number, lon: street.lon as number }),
        ),
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

    score += Math.min(6, Math.log10(Math.max(1, street.shopCount)) * 3);
    return { street, score, reasons, distanceKm };
  });

  return matches
    .filter((m) => m.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface StreetAggregate {
  street: Street;
  score: number;
  foods: { name: string; match: number }[];
}

/** 추천 음식 목록 전체를 훑어 거리별 득표를 합산한다. */
export function aggregateStreets(
  scored: ScoredFood[],
  streets: Street[],
  limit = 4,
): StreetAggregate[] {
  const bucket = new Map<string, StreetAggregate>();

  for (const item of scored) {
    for (const match of matchStreets(item.food, streets, 2)) {
      const existing = bucket.get(match.street.id);
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
  params.set("spicy", String(pref.spicy));
  params.set("soup", String(pref.soup));
  params.set("raw", pref.raw);
  params.set("ing", pref.ingredient);
  params.set("month", String(pref.month));
  params.set("course", pref.course);
  return params.toString();
}

export function preferenceFromQuery(
  query: Record<string, string | string[] | undefined>,
): Preference {
  const read = (key: string): string | undefined => {
    const raw = query[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const spicyRaw = Number(read("spicy"));
  const spicy = Number.isFinite(spicyRaw) ? Math.min(3, Math.max(0, Math.round(spicyRaw))) : 1;

  const soupRaw = Number(read("soup"));
  const soup = ([0, 1, 2] as const).includes(soupRaw as SoupPreference)
    ? (soupRaw as SoupPreference)
    : 1;

  const rawValue = read("raw");
  const raw: RawPreference = rawValue === "O" ? "O" : "X";

  const ingValue = read("ing");
  const ingredient: IngredientPreference = INGREDIENT_OPTIONS.includes(
    ingValue as IngredientPreference,
  )
    ? (ingValue as IngredientPreference)
    : "상관없음";

  const monthRaw = Number(read("month"));
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? Math.round(monthRaw)
      : DEFAULT_PREFERENCE.month;

  const courseValue = read("course");
  const course: Preference["course"] =
    courseValue === "음료" || courseValue === "전체" ? courseValue : "식사";

  return { spicy, soup, raw, ingredient, month, course };
}
