export const AXES = ["spicy", "salty", "soup", "texture", "aroma"] as const;
export type Axis = (typeof AXES)[number];

export type TasteVector = Record<Axis, number>;

/** 축 메타데이터. 색은 Figma의 taste/* 변수와 같은 값이다. */
export const AXIS_META: Record<
  Axis,
  { label: string; low: string; high: string; color: string }
> = {
  spicy: { label: "맵기", low: "순한 맛", high: "아주 매움", color: "#C4392A" },
  salty: { label: "짠맛", low: "심심하게", high: "간이 세게", color: "#2E6E8E" },
  soup: { label: "국물", low: "없어도 돼요", high: "국물이 주인공", color: "#C8862B" },
  texture: { label: "식감", low: "부드럽게", high: "쫄깃하게", color: "#6B4A8F" },
  aroma: { label: "향신료", low: "향은 순하게", high: "향이 강해도", color: "#3E7A3A" },
};

export type Course = "식사" | "디저트" | "음료";

export interface Restaurant {
  id: string;
  name: string;
  region: string;
  area: string;
  address: string;
  lat: number | null;
  lon: number | null;
  isLocalSpecialty: boolean;
}

export interface Food {
  id: string;
  name: string;
  displayName: string;
  ingredient: string;
  taste: TasteVector;
  course: Course;
  /** 맛 점수의 근거 강도. 룰이 조리법·재료를 모두 짚었으면 0.85. */
  confidence: number;
  /** "rule" | "llm" — 점수를 누가 매겼는지. 화면에 배지로 노출한다. */
  source: string;
  months: number[];
  regions: string[];
  restaurantCount: number;
  restaurants: Restaurant[];
}

export interface Street {
  id: string;
  name: string;
  description: string;
  category: "음식" | "쇼핑" | "문화" | "기타";
  foodKeywords: string[];
  sido: string;
  sigungu: string;
  address: string;
  lat: number | null;
  lon: number | null;
  coordSource: string;
  lengthM: number;
  shopCount: number;
  designatedYear: number | null;
  orgName: string;
  orgTel: string;
  dataDate: string;
}

export interface Meta {
  builtAt: string;
  foodCount: number;
  streetCount: number;
  axes: string[];
  sources: string[];
}
