"""seasonal_region_mapping.csv에 룰 엔진을 적용해 메뉴별 맛 프로파일을 만든다.

산출물
------
- data/processed/menu_taste_profile.csv : 고유 메뉴 단위 5축 점수
- data/processed/review/taste_low_confidence.csv : LLM 재평가 대상(신뢰도 < 0.6)

같은 메뉴명이 여러 식당에 반복되므로 (메뉴명, 식재료) 조합 단위로 한 번만
점수를 낸다. 웹에서는 이 표를 메뉴명으로 조인해 쓴다.

실행: python -m src.taste.build_taste_profile
"""

from __future__ import annotations

import csv
from collections import Counter

from src.config import DATA_PROCESSED_DIR, DATA_REVIEW_DIR
from src.taste.rules import AXES, score_menu, normalize_menu, is_menu_like

SOURCE = DATA_PROCESSED_DIR / "seasonal_region_mapping.csv"
OUTPUT = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
LOW_CONF = DATA_REVIEW_DIR / "taste_low_confidence.csv"
# llm_refine.py가 만들어 두면 자동으로 반영된다. 없으면 룰 결과만 쓴다.
LLM_OVERRIDE = DATA_REVIEW_DIR / "taste_llm_override.csv"

LOW_CONFIDENCE_CUTOFF = 0.60

FIELDS = [
    "menu_key", "menu_name", "menu_norm", "ingredient",
    *AXES,
    "course", "confidence", "source", "matched_terms",
    "months", "regions", "restaurant_count",
]


def _load_overrides() -> dict[str, dict]:
    if not LLM_OVERRIDE.exists():
        return {}
    with LLM_OVERRIDE.open(encoding="utf-8-sig", newline="") as fh:
        return {row["menu_key"]: row for row in csv.DictReader(fh)}


def main() -> None:
    with SOURCE.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    # (정규화 메뉴명, 식재료) 단위로 묶는다. 같은 조합이면 맛도 같다고 본다.
    groups: dict[tuple[str, str], dict] = {}
    for row in rows:
        raw_name = (row.get("menu_name") or "").strip()
        ingredient = (row.get("match_term") or "").strip()
        if not raw_name or not is_menu_like(raw_name):
            continue
        norm = normalize_menu(raw_name)
        key = (norm, ingredient)
        bucket = groups.setdefault(key, {
            "menu_name": raw_name,
            "menu_norm": norm,
            "ingredient": ingredient,
            "months": set(),
            "regions": set(),
            "restaurants": set(),
        })
        if row.get("month"):
            bucket["months"].add(int(row["month"]))
        area = (row.get("area_nm") or "").strip()
        region = (row.get("region") or "").strip()
        if region:
            bucket["regions"].add(f"{region} {area}".strip())
        if row.get("rstr_id"):
            bucket["restaurants"].add(row["rstr_id"])

    overrides = _load_overrides()
    override_hits = 0

    out_rows = []
    for (norm, ingredient), bucket in sorted(groups.items()):
        profile = score_menu(bucket["menu_name"], ingredient)
        menu_key = f"{norm}|{ingredient}"
        scores = {axis: getattr(profile, axis) for axis in AXES}
        course = profile.course
        confidence = profile.confidence
        source = "rule"

        override = overrides.get(menu_key)
        if override:
            scores = {axis: float(override[axis]) for axis in AXES}
            course = override["course"]
            # 사람이든 LLM이든 직접 본 행이므로 신뢰도를 룰 상한선까지 올린다.
            confidence = 0.85
            # 누가 매겼는지는 뭉뚱그리지 않는다. manual_labels.py는 "manual",
            # llm_refine.py는 "llm"을 적는다.
            source = override.get("source") or "llm"
            override_hits += 1

        out_rows.append({
            "menu_key": menu_key,
            "menu_name": bucket["menu_name"],
            "menu_norm": norm,
            "ingredient": ingredient,
            **scores,
            "course": course,
            "confidence": confidence,
            "source": source,
            "matched_terms": profile.matched_terms,
            "months": ";".join(str(m) for m in sorted(bucket["months"])),
            "regions": ";".join(sorted(bucket["regions"])),
            "restaurant_count": len(bucket["restaurants"]),
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out_rows)

    # LLM이 이미 덮어쓴 행은 재평가 대상에서 빠진다(source == "llm").
    low = [
        r for r in out_rows
        if r["source"] == "rule" and float(r["confidence"]) < LOW_CONFIDENCE_CUTOFF
    ]
    LOW_CONF.parent.mkdir(parents=True, exist_ok=True)
    with LOW_CONF.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(low)

    # --- 요약 ---
    print(f"원본 행       : {len(rows)}")
    print(f"고유 메뉴 조합 : {len(out_rows)}")
    print(f"LLM 보정 적용  : {override_hits}건")
    print(f"저신뢰(<{LOW_CONFIDENCE_CUTOFF}) : {len(low)}  → {LOW_CONF.name}")
    print(f"저장          : {OUTPUT}")

    course_counts = Counter(r["course"] for r in out_rows)
    print("\n코스 분포:", dict(course_counts))
    for axis in AXES:
        vals = [float(r[axis]) for r in out_rows]
        print(f"  {axis:8s} 평균 {sum(vals)/len(vals):.2f}  "
              f"최소 {min(vals):.1f}  최대 {max(vals):.1f}")


if __name__ == "__main__":
    main()
