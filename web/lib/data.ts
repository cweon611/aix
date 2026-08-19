import foodsJson from "@/public/data/foods.json";
import streetsJson from "@/public/data/streets.json";
import metaJson from "@/public/data/meta.json";

import type { Food, Meta, Restaurant, Street } from "./types";

// 빌드 시점에 번들로 굳는다. 2천 행 수준이라 서버도 DB도 필요 없다.
// 데이터를 갱신하려면 python -m src.export.build_web_data 를 다시 돌린다.
export const foods = foodsJson as unknown as Food[];
export const streets = streetsJson as unknown as Street[];
export const meta = metaJson as unknown as Meta;

export function findFood(id: string): Food | undefined {
  return foods.find((f) => f.id === id);
}

export function findStreet(id: string): Street | undefined {
  return streets.find((s) => s.id === id);
}

/** 한 식당이 파는 제철 음식 하나. */
export interface RestaurantFood {
  id: string;
  name: string;
  ingredient: string;
  months: number[];
}

export interface RestaurantEntry {
  restaurant: Restaurant;
  foods: RestaurantFood[];
}

/**
 * 식당 id → 그 식당 정보 + 파는 제철 음식들.
 *
 * foods.json은 음식마다 식당을 담고 있어서, 한 식당이 여러 음식에 흩어져
 * 나온다. 식당 상세 화면을 세우려면 그걸 식당 기준으로 다시 모아야 한다.
 * 좌표 있는 식당만 담는다 — 지도에 못 찍는 식당은 상세로 갈 길이 없다.
 */
const RESTAURANTS: Map<string, RestaurantEntry> = (() => {
  const map = new Map<string, RestaurantEntry>();
  for (const food of foods) {
    for (const r of food.restaurants) {
      if (r.lat === null || r.lon === null || !r.id) continue;
      let entry = map.get(r.id);
      if (!entry) {
        entry = { restaurant: r, foods: [] };
        map.set(r.id, entry);
      }
      // 향토 표시가 붙은 레코드를 대표로 남긴다.
      if (r.isLocalSpecialty && !entry.restaurant.isLocalSpecialty) {
        entry.restaurant = r;
      }
      if (!entry.foods.some((f) => f.id === food.id)) {
        entry.foods.push({
          id: food.id,
          name: food.name,
          ingredient: food.ingredient,
          months: food.months,
        });
      }
    }
  }
  return map;
})();

export function findRestaurant(id: string): RestaurantEntry | undefined {
  return RESTAURANTS.get(id);
}

export function allRestaurants(): RestaurantEntry[] {
  return [...RESTAURANTS.values()];
}

export function restaurantIds(): string[] {
  return [...RESTAURANTS.keys()];
}
