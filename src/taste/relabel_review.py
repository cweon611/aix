"""주재료·맵기 라벨을 새 기준으로 다시 매기고, 검토 결과를 JSON으로 낸다.

왜 새로 매기는가
----------------
1) 주재료: rules.py는 두 계열이 부딪히면 둘 다 붙였다. 그 결과 조리법 단어
   ('탕수육'의 수육, '뚝배기'의 배)나 곁재료(들깨·묵은지·쌈·버섯)까지 라벨이
   되어 복수 라벨이 96건까지 늘었다. 대표 재료는 하나가 기본이다.
2) 맵기: 3단계가 5건뿐이라 지표 구실을 못 한다. 기준을 다시 세운다.
     0 전혀 안 매움
     1 양념이 들어가긴 하나 매운맛이 주요맛이 아님
     2 매운 양념이 음식의 주요맛
     3 강한 매운맛을 특징으로 하는 음식

판정 근거는 메뉴명(menu_norm)뿐이다. 이름에 없는 사실은 확신하지 않고
confidence를 낮춘 뒤 needs_review로 넘긴다.

실행: python -m src.taste.relabel_review
"""

from __future__ import annotations

import csv
import json
from collections import Counter

from src.config import DATA_PROCESSED_DIR, DATA_REVIEW_DIR

PROFILE = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
OUTPUT = DATA_REVIEW_DIR / "taste_relabel_review.json"

SEAFOOD, MEAT, VEGGIE = "해산물", "육류", "채소"
CATEGORIES = (SEAFOOD, MEAT, VEGGIE)

# --------------------------------------------------------------------------
# 주재료 사전
#
# CORE   그 자체로 대표 주재료가 될 수 있는 재료어.
# SECOND 곁재료·양념·반죽/곡물처럼 음식 정체성의 핵심이 아닌 재료어.
#        다른 계열에 CORE 근거가 하나도 없을 때만 대표로 승격한다.
#        (도토리묵은 채소, 도토리해물파전은 해산물이 되는 이유다.)
#
# 조리법 단어는 어느 쪽에도 넣지 않는다. '수육'·'탕수육'은 육류가 아니고
# '회'는 해산물이 아니다.
# --------------------------------------------------------------------------

CORE = {
    SEAFOOD: (
        "세발낙지", "산낙지", "낙지", "전복", "갈치", "새꼬막", "참꼬막", "꼬막",
        "꽃게", "칠게", "대게", "게장", "홍어", "보리굴비", "굴비", "조기", "굴",
        "아귀", "아구", "병어", "바지락", "고등어", "삼치", "붕장어", "장어", "하모",
        "민어", "키조개", "갑오징어", "오징어", "주꾸미", "쭈꾸미", "대하", "새우",
        "문어", "우럭", "농어", "도다리", "방어", "전어", "매생이", "톳", "해조류",
        "멸치", "다슬기", "짱뚱어", "대구", "멍게", "해삼", "서대", "코다리", "명태",
        "미역", "백합", "소라", "해물", "해산물", "생선", "활어", "우렁이", "우렁",
        "가리비", "홍합", "골뱅이", "붕어", "메기", "미꾸라지", "추어", "관자",
    ),
    MEAT: (
        "한우암소", "한우", "쇠고기", "소고기", "돼지고기", "암돼지", "삼겹살", "목살",
        "차돌", "육회", "육개장", "유황오리", "오리", "토종닭", "닭가슴살", "닭",
        "흑염소", "곱창", "대창", "막창", "떡갈비", "갈비", "불고기", "불백", "제육",
        "보쌈", "삼계탕", "백숙", "주물럭", "돈까스", "스테이크", "베이컨", "햄",
    ),
    VEGGIE: (
        "죽순", "애호박", "단호박", "호박", "순두부", "두부", "시금치", "열무",
        "감자", "고구마", "옥수수", "수수", "가지", "토마토", "유자", "매실", "대추",
        "도라지", "더덕", "산딸기", "딸기", "무화과", "사과", "복숭아", "멜론",
        "팥", "한라봉", "포도", "블루베리", "오디", "자두", "석류", "곶감", "밤",
        "토란", "오미자", "구기자", "연잎", "청포도",
    ),
}

SECOND = {
    VEGGIE: (
        "들깨", "묵은지", "갓김치", "김치", "시래기", "콩나물", "콩", "미나리",
        "야채", "채소", "산채", "나물", "새싹", "상추", "양파", "마늘", "생강",
        "곰보배추", "배추", "배", "버섯", "표고", "능이", "고추", "쌈밥", "쌈",
        "메밀", "우리밀", "쌀", "보리", "흑미", "녹두", "도토리", "바질", "샐러드",
        "청국장", "된장",
        # 쑥은 도다리쑥국에서 향채다. 쑥차·쑥라떼처럼 다른 근거가 없을 때만
        # 대표로 올라온다.
        "쑥",
    ),
}

# 양념 이름일 뿐 재료 근거로 쓰지 않는다. 매칭 전에 지운다.
# '유자골'·'오리엔탈'은 지명·수식어인데 재료어를 품고 있어 함께 지운다.
STRIP_BEFORE_MATCH = ("고추장", "유자골", "오리엔탈", "대통밥")

# --------------------------------------------------------------------------
# 맵기 사전
# --------------------------------------------------------------------------

# 3 — 강한 매운맛 자체가 그 음식의 특징
SPICY3_TOKENS = (
    "아주 매운", "매운", "얼큰", "불닭", "화끈", "땡초", "청양",
    "매운탕", "아귀찜", "아구찜", "낙지볶음", "짬뽕", "육개장", "떡볶이", "닭발",
)
# 2 — 매운 양념이 주요맛
SPICY2_TOKENS = (
    "무침", "비빔", "볶음", "제육", "주물럭", "매콤", "조림", "찌개", "물회",
    "덮밥", "라면", "순두부", "김치", "묵은지", "쟁반", "알탕", "꽃게탕", "고추장",
)
# 1 — 양념은 있으나 매운맛이 주요맛은 아님
SPICY1_TOKENS = (
    "게장", "간장", "꼬막장", "전복장", "젓갈", "젓", "떡갈비", "갈비", "불고기",
    "불백", "숯불", "국밥", "보쌈", "잡채", "찜", "전골", "쌈밥", "호롱", "짜장",
    "추어", "보리밥", "청국장",
)
# 맵지 않다고 이름이 말해 주는 조리법. 2·1보다 먼저 본다.
NOT_SPICY_TOKENS = (
    "하얀", "맑은", "지리", "간국", "샤브", "백숙", "삼계탕", "탕수", "수육",
    "초밥", "사시미", "숙회", "연포탕",
)
# 순한 조리법. 구체 신호를 다 본 뒤, '정식/백반'으로 넘어가기 전에 본다.
MILD_TOKENS = (
    "회", "구이", "죽", "튀김", "칼국수", "수제비", "냉면", "떡국", "솥밥", "묵밥",
    "만두", "국수", "탕", "국", "뚝배기", "전병", "파전", "육전", "스테이크",
    "샐러드", "파스타", "피자", "리소토",
)
# 이것만으로는 맵기를 정할 수 없는, 상차림을 가리키는 말
SET_TOKENS = ("정식", "백반", "한상", "세트", "코스")

# 생선 + 찜은 고춧가루 양념찜이다. 꽃게찜·전복찜과는 다르다.
FISH_FOR_STEAM = ("갈치", "병어", "우럭", "대구", "코다리", "명태", "홍어", "삼치", "고등어")

# 이름만으로는 룰이 놓치는 것들. 근거를 함께 적는다.
SPICY_EXCEPTIONS: dict[str, tuple[int, str]] = {
    "고추잡채": (2, "고추·피망이 주재료라 매운맛이 주요맛이다"),
    "홍어애탕": (1, "된장·보리순 국물이라 매운맛이 주요맛은 아니다"),
    "보리애국": (1, "된장 국물에 보리순을 넣는다"),
    "아귀대창": (2, "매콤한 양념으로 내는 것이 일반적이나 조리법이 이름에 없다"),
    "표고버섯 메밀 골동면": (1, "골동면은 비빔면이나 양념이 간장인지 고추장인지 이름에 없다"),
}

# 조리법이 이름에 없어도 0이 확실한 것들 — 검수 대상에서 뺀다.
ZERO_IS_OBVIOUS = (
    "삶은", "생두부", "모두부", "색동두부", "도토리묵", "쌀밥", "바질토마토",
    "참꼬막", "통꼬막", "해삼멍게", "꽃게살", "매생이", "톳밥", "기절낙지",
    "산낙지", "세발낙지", "생굴", "대방어", "삼합",
)

# --------------------------------------------------------------------------
# 검수 대상 — 이름이 잘렸거나, 구성을 이름만으로 알 수 없는 것들
# --------------------------------------------------------------------------

TRUNCATED = {
    "갈치)|갈치": "이름이 '갈치)'에서 잘렸다",
    "조림|병어": "원본이 '조림(병어'에서 잘렸다",
    "추가메뉴|소고기": "원본이 '추가메뉴(소고기샤브'에서 잘렸다",
    "해양치유밥상|전복": "원본이 '해양치유밥상(전복해조류떡갈비'에서 잘렸다",
}

COMPOSITION_UNKNOWN = {
    "상추 튀김|상추": "무엇을 튀겼는지 이름에 없다. 광주 상추튀김은 통상 오징어튀김이지만 이름만으로는 단정할 수 없다",
    "홍어일품상|홍어": "'일품상'의 구성이 이름에 없다. 삼합 여부를 단정할 수 없다",
    "우리밀 초계국수|우리밀": "초계는 닭 육수를 뜻하나 재료가 이름에 없다",
    "고추장구이|고추": "무엇을 구웠는지 이름에 없다. 고추장은 양념이라 재료 근거가 아니다",
    "오징어육개장|오징어": "소고기가 함께 들어가는지 이름만으로 알 수 없다",
    "죽순게장 한우정식|죽순": "죽순·게장·한우 세 계열이 한 상에 나온다. 대표를 하나로 정하기 어렵다",
    "리코타치즈샐러드|리코타치즈": "유제품이 주재료인데 허용 라벨(해산물·육류·채소)에 해당이 없다",
    "죽순바삭만두|죽순": "만두소 구성이 이름에 없다",
    "주꾸미대하|주꾸미": "조리법이 이름에 없다",
    "주꾸미대하|대하": "조리법이 이름에 없다",
    "아귀대창|아귀": "조리법이 이름에 없다",
}

# 이름만으로 대표를 못 정하는 예외. (라벨, 근거)
ING_EXCEPTIONS: dict[str, tuple[list[str], str]] = {
    "삼합|소고기": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다"),
    "삼합|키조개": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다"),
    "삼합|표고버섯": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다. 표고는 곁재료"),
    "홍어삼합|홍어": ([SEAFOOD, MEAT], "삼합은 홍어와 돼지수육이 함께여야 성립하는 이름이다"),
    "오징어육개장|오징어": ([SEAFOOD], "대표는 오징어. 소고기가 함께 들어가는지는 이름에 없다"),
    "죽순게장 한우정식|죽순": ([SEAFOOD, VEGGIE], "죽순게장이 주 메뉴이고 한우는 상차림 구성이다"),
    "홍어일품상|홍어": ([SEAFOOD], "대표는 홍어. 돼지수육이 함께 나오는지는 이름에 없다"),
    "고추장구이|고추": ([], "고추장은 양념이라 재료 근거가 아니다. 무엇을 구웠는지 이름에 없다"),
}

# 순두부 계열은 앞에 무엇이 붙든 대표 재료가 순두부다.
SOONDUBU = "순두부"


# --------------------------------------------------------------------------
# 주재료 판정
# --------------------------------------------------------------------------

def _hits(text: str, tokens: tuple[str, ...]) -> str | None:
    """가장 긴 매칭 토큰을 돌려준다. 없으면 None."""
    best = None
    for token in tokens:
        if token in text and (best is None or len(token) > len(best)):
            best = token
    return best


def resolve_ingredients(menu_key: str, menu_norm: str, ingredient: str) -> dict:
    if menu_key in ING_EXCEPTIONS:
        labels, reason = ING_EXCEPTIONS[menu_key]
        return {"labels": labels, "reason": reason, "basis": "예외"}

    text = menu_norm
    for junk in STRIP_BEFORE_MATCH:
        text = text.replace(junk, " ")

    if SOONDUBU in text:
        return {
            "labels": [VEGGIE],
            "reason": "순두부찌개 계열. 앞에 붙는 해물·고기는 부재료이고 대표는 순두부다",
            "basis": "대표 1개",
        }

    core = {cat: _hits(text, tokens) for cat, tokens in CORE.items()}
    core = {cat: tok for cat, tok in core.items() if tok}

    if not core and ingredient:
        # 이름이 잘려 재료어가 없을 때만 매칭된 제철 식재료로 보완한다.
        core = {cat: _hits(ingredient, tokens) for cat, tokens in CORE.items()}
        core = {cat: tok for cat, tok in core.items() if tok}
        basis_note = "이름에 재료어가 없어 매칭 식재료로 보완"
    else:
        basis_note = ""

    if core:
        labels = [c for c in CATEGORIES if c in core]
        if len(labels) >= 2:
            named = " · ".join(f"{c}({core[c]})" for c in labels)
            reason = f"{named} 이 각각 독립된 재료어로 이름에 있고 어느 하나를 빼면 그 음식이 아니다"
            basis = "복수 유지"
        else:
            cat = labels[0]
            reason = f"대표 재료는 {core[cat]}. 나머지는 곁재료·양념·조리법 단어라 라벨로 세지 않는다"
            basis = "대표 1개"
        if basis_note:
            reason = f"{reason}. {basis_note}"
        return {"labels": labels[:2], "reason": reason, "basis": basis}

    second = {cat: _hits(text, tokens) for cat, tokens in SECOND.items()}
    second = {cat: tok for cat, tok in second.items() if tok}
    if second:
        cat = next(c for c in CATEGORIES if c in second)
        return {
            "labels": [cat],
            "reason": f"핵심 재료어가 없고 {second[cat]}만 있다. 이 음식에서는 {second[cat]}가 대표다",
            "basis": "곁재료 승격",
        }

    return {"labels": [], "reason": "허용 라벨(해산물·육류·채소)에 해당하는 재료어가 이름에 없다", "basis": "근거 없음"}


# --------------------------------------------------------------------------
# 맵기 판정
# --------------------------------------------------------------------------

def resolve_spicy(menu_norm: str, course: str) -> dict:
    if course in ("디저트", "음료"):
        return {"level": 0, "reason": f"{course}라 맵기를 따질 대상이 아니다", "matched": course}

    for name, (level, reason) in SPICY_EXCEPTIONS.items():
        if name in menu_norm:
            return {"level": level, "reason": reason, "matched": name}

    token = _hits(menu_norm, SPICY3_TOKENS)
    if token:
        return {"level": 3, "reason": f"'{token}'은 강한 매운맛 자체가 특징인 음식이다", "matched": token}
    if "양념" in menu_norm and ("게장" in menu_norm or "꼬막" in menu_norm):
        return {"level": 3, "reason": "양념게장·양념꼬막은 고춧가루 양념의 매운맛이 특징이다", "matched": "양념"}
    if "주꾸미" in menu_norm and ("볶음" in menu_norm or "쌈밥" in menu_norm):
        return {"level": 3, "reason": "주꾸미볶음은 강한 매운맛이 특징이다", "matched": "주꾸미볶음"}

    token = _hits(menu_norm, NOT_SPICY_TOKENS)
    if token:
        return {"level": 0, "reason": f"'{token}'은 맵게 내지 않는 조리법이다", "matched": token}

    if "된장" in menu_norm or "청국장" in menu_norm:
        return {"level": 1, "reason": "된장·청국장 양념이라 매운맛이 주요맛은 아니다", "matched": "된장"}

    if "찜" in menu_norm:
        fish = _hits(menu_norm, FISH_FOR_STEAM)
        if fish:
            return {"level": 2, "reason": f"{fish}찜은 고춧가루 양념이 주요맛이다", "matched": f"{fish}찜"}

    token = _hits(menu_norm, SPICY2_TOKENS)
    if token:
        if token == "전골":
            pass
        else:
            return {"level": 2, "reason": f"'{token}'은 매운 양념이 주요맛인 조리법이다", "matched": token}

    if "전골" in menu_norm and _hits(menu_norm, ("낙지", "김치", "불고기", "곱창")):
        return {"level": 2, "reason": "낙지·김치를 넣은 전골은 얼큰한 국물이 주요맛이다", "matched": "전골"}

    if "주꾸미" in menu_norm:
        return {"level": 2, "reason": "주꾸미 요리는 매운 양념으로 내는 것이 일반적이다", "matched": "주꾸미"}

    token = _hits(menu_norm, SPICY1_TOKENS)
    if token:
        return {"level": 1, "reason": f"'{token}'은 양념이 들어가되 매운맛이 주요맛은 아니다", "matched": token}

    token = _hits(menu_norm, MILD_TOKENS)
    if token or menu_norm.endswith("전"):
        hit = token or "전"
        return {"level": 0, "reason": f"'{hit}'은 양념을 매운맛으로 쓰지 않는 조리법이다", "matched": hit}

    token = _hits(menu_norm, SET_TOKENS)
    if token:
        return {"level": 1, "reason": f"'{token}'은 반찬에 양념이 따르나 매운맛이 주요맛은 아니다", "matched": token}

    return {"level": 0, "reason": "조리법을 가리키는 말이 이름에 없다", "matched": None}


# --------------------------------------------------------------------------
# 신뢰도와 검수 대상
# --------------------------------------------------------------------------

ING_CONFIDENCE = {
    "대표 1개": 0.85,
    "복수 유지": 0.80,
    "곁재료 승격": 0.70,
    "예외": 0.70,
    "근거 없음": 0.30,
}

_SEPARATORS = (",", "/", "+", "&")


def collect_review_notes(row: dict, menu_norm: str, ing: dict, spicy: dict) -> list[str]:
    """왜 사람이 다시 봐야 하는지를 모은다. 비어 있으면 검수 대상이 아니다."""
    notes = []
    key = row["menu_key"]
    if key in TRUNCATED:
        notes.append(TRUNCATED[key])
    if key in COMPOSITION_UNKNOWN:
        notes.append(COMPOSITION_UNKNOWN[key])
    if any(sep in menu_norm for sep in _SEPARATORS):
        notes.append("한 항목에 여러 메뉴가 묶여 있어 대표 메뉴를 고를 수 없다")
    if not ing["labels"]:
        notes.append("주재료 라벨을 붙일 근거가 없다")
    if spicy["matched"] is None and not any(k in menu_norm for k in ZERO_IS_OBVIOUS):
        notes.append("조리법이 이름에 없어 맵기를 기본값 0으로 두었다")
    return notes


def main() -> None:
    with PROFILE.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    items = []
    for row in rows:
        menu_norm = row["menu_norm"]
        course = row["course"]
        before_ing = [c for c in row["main_ingredients"].split(";") if c]
        before_spicy = int(row["spicy"])

        ing = resolve_ingredients(row["menu_key"], menu_norm, row["ingredient"])
        spicy = resolve_spicy(menu_norm, course)
        notes = collect_review_notes(row, menu_norm, ing, spicy)
        needs_review = bool(notes)

        ing_conf = ING_CONFIDENCE[ing["basis"]]
        if spicy["matched"] in (None,):
            spicy_conf = 0.40
        elif spicy["matched"] in SET_TOKENS:
            spicy_conf = 0.60
        elif spicy["matched"] in ("디저트", "음료"):
            spicy_conf = 0.90
        elif spicy["matched"] in SPICY_EXCEPTIONS:
            spicy_conf = 0.70
        else:
            spicy_conf = 0.85
        if needs_review:
            ing_conf = min(ing_conf, 0.50)
            spicy_conf = min(spicy_conf, 0.60)

        items.append({
            "menu_key": row["menu_key"],
            "menu_name": row["menu_name"],
            "course": course,
            "main_ingredients": {
                "before": before_ing,
                "after": ing["labels"],
                "changed": before_ing != ing["labels"],
                "basis": ing["basis"],
                "confidence": round(ing_conf, 2),
                "reason": ing["reason"],
            },
            "spicy": {
                "before": before_spicy,
                "after": spicy["level"],
                "changed": before_spicy != spicy["level"],
                "matched": spicy["matched"],
                "confidence": round(spicy_conf, 2),
                "reason": spicy["reason"],
            },
            "needs_review": needs_review,
            "review_notes": notes,
        })

    def dist(pick) -> dict:
        return dict(sorted(Counter(pick(i) for i in items).items(), key=lambda kv: str(kv[0])))

    meals = [i for i in items if i["course"] == "식사"]
    payload = {
        "generated_from": PROFILE.name,
        "criteria": {
            "main_ingredients": [
                "허용 라벨은 해산물·육류·채소 세 가지뿐이다",
                "대표 주재료는 기본 1개만 고른다",
                "양념·곁재료·부재료는 음식 정체성의 핵심이 아니면 라벨로 세지 않는다",
                "두 재료군이 메뉴명과 실제 구성에서 모두 핵심일 때만 복수 라벨을 남긴다",
                "조리법 단어를 재료로 세지 않는다 (탕수육·수육의 '육', 죽순회의 '회')",
                "이름에 없는 사실은 확신하지 않는다. 불확실하면 confidence를 낮추고 needs_review로 넘긴다",
            ],
            "spicy": {
                "0": "전혀 안 매움",
                "1": "양념이 들어가긴 하나 매운맛이 주요맛이 아님",
                "2": "매운 양념이 음식의 주요맛",
                "3": "강한 매운맛을 특징으로 하는 음식",
            },
        },
        "summary": {
            "menu_count": len(items),
            "meal_count": len(meals),
            "needs_review": sum(1 for i in items if i["needs_review"]),
            "main_ingredients": {
                "before": dist(lambda i: ";".join(i["main_ingredients"]["before"]) or "(없음)"),
                "after": dist(lambda i: ";".join(i["main_ingredients"]["after"]) or "(없음)"),
                "multi_before": sum(1 for i in items if len(i["main_ingredients"]["before"]) > 1),
                "multi_after": sum(1 for i in items if len(i["main_ingredients"]["after"]) > 1),
                "changed": sum(1 for i in items if i["main_ingredients"]["changed"]),
            },
            "spicy": {
                "before": dist(lambda i: i["spicy"]["before"]),
                "after": dist(lambda i: i["spicy"]["after"]),
                "meal_before": dict(sorted(Counter(i["spicy"]["before"] for i in meals).items())),
                "meal_after": dict(sorted(Counter(i["spicy"]["after"] for i in meals).items())),
                "changed": sum(1 for i in items if i["spicy"]["changed"]),
            },
        },
        "items": items,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    s = payload["summary"]
    print(f"메뉴 {s['menu_count']}건 (식사 {s['meal_count']}건), 검수 필요 {s['needs_review']}건")
    print("주재료 복수 라벨:", s["main_ingredients"]["multi_before"], "->", s["main_ingredients"]["multi_after"])
    print("주재료 분포 after:", s["main_ingredients"]["after"])
    print("맵기 전체 before:", s["spicy"]["before"])
    print("맵기 전체 after :", s["spicy"]["after"])
    print("맵기 식사 before:", s["spicy"]["meal_before"])
    print("맵기 식사 after :", s["spicy"]["meal_after"])
    print("저장:", OUTPUT)


if __name__ == "__main__":
    main()
