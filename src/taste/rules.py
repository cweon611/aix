"""메뉴명에서 5축 맛 프로파일(맵기·짠맛·국물·식감·향신료)을 산출하는 룰 엔진.

설계 원칙
---------
1. 조리법이 국물감·짠맛을 지배하고, 주재료가 식감·향을 지배한다.
   그래서 축마다 어느 사전을 먼저 볼지 다르게 잡았다.
2. `soup`(국물)만 앵커 방식이다. 탕/구이처럼 조리법이 정해지면 국물 유무는
   거의 확정되므로, 델타를 누적하는 대신 가장 강한 앵커 하나를 채택한다.
   나머지 축은 근거가 쌓일수록 강해지는 성질이라 델타 누적이 맞다.
3. 신뢰도(confidence)는 "조리법과 주재료를 각각 몇 개나 짚었는가"로 매긴다.
   0.6 미만은 LLM 재평가 대상이다(llm_refine.py).

축 정의 (1~5)
-------------
- spicy   : 1 안 매움 → 5 아주 매움
- salty   : 1 심심함 → 5 아주 짬
- soup    : 1 국물 없음 → 5 국물이 주인공
- texture : 1 부드럽고 무름 → 5 쫄깃하고 단단함
- aroma   : 1 향이 순함 → 5 향이 강하고 개성 있음
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict

AXES = ("spicy", "salty", "soup", "texture", "aroma")

# 1~5 척도를 벗어나는 값이 웹으로 새어나가면 슬라이더가 깨지므로 항상 여기서 자른다.
SCORE_MIN, SCORE_MAX = 1.0, 5.0


# --------------------------------------------------------------------------
# 정규화
# --------------------------------------------------------------------------

# "갈치조림 등", "낙지볶음 외" 처럼 데이터 원본에 붙어 있는 나열 꼬리표.
_TRAILING_NOISE = re.compile(r"[\s,/·]*(등|외|기타)\s*$")
# "조림(병어", "활어회(참돔 / 농어 / 우럭 등)" 같은 깨진 괄호 조각.
_BRACKETS = re.compile(r"[（(\[][^）)\]]*[）)\]]?")
_PRICE_NOTE = re.compile(r"※.*$")
_MULTISPACE = re.compile(r"\s+")

# 메뉴명이 아니라 안내문에 가까운 행. 룰을 태우면 오히려 잡음이 되므로 걸러낸다.
_NOT_A_MENU = re.compile(r"(변동|문의|권장|예약|사전|참고 요망)")


def normalize_menu(name: str) -> str:
    """비교·매칭용으로 메뉴명을 다듬는다. 표시용 이름과는 별개다."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKC", name)
    text = _PRICE_NOTE.sub("", text)
    text = _BRACKETS.sub(" ", text)
    text = text.replace("ㆍ", " ").replace("·", " ")
    text = _MULTISPACE.sub(" ", text).strip()
    # 나열 꼬리표는 괄호를 지운 뒤에야 문장 끝에 드러나는 경우가 많다.
    for _ in range(2):
        text = _TRAILING_NOISE.sub("", text).strip()
    return text


def is_menu_like(name: str) -> bool:
    """메뉴명으로 볼 수 있는 문자열인지. 안내문·초장문은 제외한다."""
    text = normalize_menu(name)
    if len(text) < 2 or len(text) > 40:
        return False
    return not _NOT_A_MENU.search(text)


# --------------------------------------------------------------------------
# 코스 분류 — 디저트·음료를 식사와 같은 잣대로 재면 맵기 축이 무의미해진다.
# --------------------------------------------------------------------------

DRINK_KEYWORDS = (
    "라떼", "에이드", "스무디", "아메리카노", "커피", "아인슈페너", "쥬스", "주스",
    "우유", "차 ", "티", "식혜", "수정과", "쌍화차", "모히또", "아이스티", "밀크",
)
DESSERT_KEYWORDS = (
    "빙수", "케이크", "케익", "타르트", "크로플", "와플", "파르페", "젤라또", "아이스크림",
    "빵", "베이글", "도넛", "도나스", "쿠키", "약과", "양갱", "푸딩", "깜빠뉴", "파운드",
    "떡", "개떡", "전병", "스프", "샐러드", "피자", "파스타", "라자냐", "리소토", "돈까스",
)
# 위 사전에 걸리지만 실제로는 끼니인 메뉴들. 사전 순서로는 못 풀어서 따로 뺀다.
_COURSE_OVERRIDE_MEAL = (
    "떡국", "떡갈비", "떡볶이", "물떡", "쌀떡", "치즈떡",
    "죽순떡갈비", "오리떡갈비", "닭떡갈비", "유황오리떡갈비",
    "전복빵",  # 완도 전복빵은 간식이지만 매장 분류상 식사로 취급되어 온 항목
)


def classify_course(menu_norm: str) -> str:
    """'식사' | '디저트' | '음료'."""
    for kw in _COURSE_OVERRIDE_MEAL:
        if kw in menu_norm:
            if kw == "전복빵":
                return "디저트"
            return "식사"
    for kw in DRINK_KEYWORDS:
        if kw in menu_norm:
            return "음료"
    for kw in DESSERT_KEYWORDS:
        if kw in menu_norm:
            return "디저트"
    return "식사"


# --------------------------------------------------------------------------
# 조리법 사전
# --------------------------------------------------------------------------

# soup 앵커: 조리법이 확정되면 국물 유무도 사실상 확정된다.
SOUP_ANCHORS: dict[str, float] = {
    # 국물이 주인공
    "연포탕": 5.0, "매운탕": 5.0, "지리": 5.0, "간국": 5.0, "해신탕": 5.0,
    "탕": 4.8, "국밥": 4.8, "곰탕": 4.8, "삼계탕": 4.8, "육개장": 4.8,
    "찌개": 4.5, "전골": 4.5, "샤브": 4.5, "뚝배기": 4.5, "국": 4.5,
    "칼국수": 4.3, "수제비": 4.3, "라면": 4.3, "짬뽕": 4.3, "국수": 4.0,
    "죽": 4.0, "쌀국수": 4.3, "물회": 4.0, "냉면": 3.8, "떡국": 4.3,
    # 국물이 적거나 자작한 정도
    "조림": 2.6, "찜": 2.4, "볶음": 1.8, "쌈밥": 2.0, "비빔밥": 1.8,
    "솥밥": 1.8, "덮밥": 2.0, "백반": 3.2, "정식": 3.0, "한정식": 3.0,
    # 국물 없음
    "구이": 1.2, "회": 1.1, "무침": 1.3, "전": 1.2, "튀김": 1.1,
    "숙회": 1.2, "사시미": 1.1, "초밥": 1.1, "보쌈": 1.3, "수육": 1.5,
    "장": 1.5, "게장": 1.5, "젓갈": 1.2, "탕탕이": 1.2, "호롱": 1.2,
    "비빔면": 1.5, "쟁반국수": 1.8, "골동면": 1.8, "짜장면": 1.5,
    "삼합": 1.3, "코스": 2.2, "한상": 3.0, "유비끼": 1.5, "다짐": 1.2,
}

SPICY_DELTAS: dict[str, float] = {
    "매운": 1.6, "얼큰": 1.6, "고추장": 1.4, "매콤": 1.4, "불닭": 1.8,
    "아귀찜": 1.6, "매운탕": 1.6, "육개장": 1.4, "짬뽕": 1.2, "떡볶이": 1.4,
    "볶음": 0.9, "찜": 0.5, "무침": 0.8, "초무침": 0.7, "회무침": 0.8,
    "양념": 0.9, "김치": 0.7, "묵은지": 0.6, "갓김치": 0.8, "조림": 0.5,
    "낙지볶음": 1.4, "주꾸미": 1.2, "짱뚱어": 0.5, "칠게장": 0.6,
    "닭발": 1.6, "곱창": 0.5, "제육": 0.9, "주물럭": 0.8,
    # 매움을 확실히 끌어내리는 신호
    "지리": -1.0, "간장": -0.8, "백숙": -0.8, "물회": -0.3, "수육": -0.6,
    "샤브": -0.8, "죽": -0.8, "된장": -0.4, "순두부": -0.2,
}

SALTY_DELTAS: dict[str, float] = {
    "젓갈": 1.8, "젓": 1.2, "장아찌": 1.4, "간장게장": 1.2, "게장": 1.0,
    "장": 0.7, "조림": 0.9, "된장": 0.8, "청국장": 1.0, "고추장": 0.7,
    "굴비": 1.2, "자반": 1.2, "묵은지": 0.6, "김치": 0.5, "양념": 0.5,
    "구이": 0.3, "볶음": 0.4, "국밥": 0.3, "찌개": 0.5,
    # 심심한 쪽
    "죽": -1.2, "회": -0.9, "사시미": -0.9, "숙회": -0.7, "물회": -0.4,
    "백숙": -0.6, "수육": -0.4, "샤브": -0.6, "생": -0.5, "지리": -0.5,
    "두부": -0.4, "쌀밥": -0.6, "보리밥": -0.5,
}

# --------------------------------------------------------------------------
# 주재료 사전 — 식감·향을 결정한다.
# --------------------------------------------------------------------------

# texture: 1 부드러움 ↔ 5 쫄깃/단단. 재료가 정해지면 조리법보다 지배적이다.
TEXTURE_ANCHORS: dict[str, float] = {
    # 쫄깃한 쪽
    "낙지": 4.8, "세발낙지": 4.8, "산낙지": 5.0, "주꾸미": 4.7, "오징어": 4.6,
    "갑오징어": 4.6, "전복": 4.7, "소라": 4.7, "꼬막": 4.4, "키조개": 4.2,
    "바지락": 4.0, "홍어": 4.2, "해삼": 4.5, "멍게": 4.0, "문어": 4.6,
    "곱창": 4.5, "대창": 4.5, "막창": 4.5, "떡": 4.2, "면": 3.8,
    "죽순": 4.0, "더덕": 4.0, "도토리묵": 3.4, "묵밥": 3.2, "톳": 3.8,
    "매생이": 2.4, "해초": 3.6, "육회": 3.6, "떡갈비": 3.6, "육전": 3.4,
    "회": 3.8, "삼겹살": 3.8, "보쌈": 3.6, "튀김": 3.8, "구이": 3.6,
    # 부드러운 쪽
    "두부": 1.6, "순두부": 1.2, "죽": 1.2, "푸딩": 1.1, "커스터드": 1.1,
    "빙수": 1.4, "케이크": 1.5, "라떼": 1.0, "우유": 1.0, "에이드": 1.0,
    "스무디": 1.2, "젤라또": 1.2, "아이스크림": 1.2, "수정과": 1.0,
    # 한 글자 키('간', '애')는 간장·애호박까지 잡아 오탐이 나므로 쓰지 않는다.
    "계란": 1.8, "알탕": 2.0, "홍어애": 1.8, "장어": 2.6, "붕장어": 2.6,
    "민어": 2.6, "대구": 2.4, "아귀": 2.6, "조기": 2.8, "갈치": 2.6,
    "고등어": 2.8, "삼치": 2.6, "병어": 2.6, "전어": 3.0, "굴": 2.2,
    "우럭": 3.0, "농어": 3.2, "도다리": 3.0, "방어": 3.2, "하모": 3.0,
    "꽃게": 3.4, "게": 3.4, "새우": 3.6, "대하": 3.6,
}

# aroma: 향의 강도. 발효·한약재·허브·향채가 올리고, 유제품·곡물이 내린다.
AROMA_DELTAS: dict[str, float] = {
    "홍어": 2.4, "청국장": 2.0, "젓갈": 1.6, "젓": 1.0, "묵은지": 1.0,
    "갓김치": 1.0, "된장": 0.9, "김치": 0.7, "곰삭": 1.6, "삭힌": 1.6,
    "들깨": 1.2, "깻잎": 0.9, "쑥": 1.4, "더덕": 1.3, "도라지": 1.1,
    "미나리": 1.0, "부추": 0.8, "마늘": 0.9, "생강": 1.2, "대추": 0.9,
    "유자": 1.2, "한라봉": 0.8, "오미자": 1.1, "쌍화": 1.5, "석류": 0.8,
    "능이": 1.4, "표고": 0.9, "버섯": 0.7, "취": 0.9, "산채": 1.0,
    "곰보배추": 1.2, "해풍쑥": 1.4, "메밀": 0.7, "고추장": 0.7, "카레": 1.6,
    "바질": 1.3, "토마토": 0.6, "치즈": 0.8, "레몬머틀": 1.3, "말차": 1.0,
    "커피": 1.0, "아인슈페너": 1.0, "무화과": 0.7, "복숭아": 0.6,
    "장어": 0.8, "곱창": 1.2, "대창": 1.2, "오리": 0.9, "흑염소": 1.4,
    "추어": 1.3, "짱뚱어": 1.3, "다슬기": 0.9, "물회": 0.6,
    # 향이 순한 쪽
    "우유": -1.0, "쌀": -0.8, "밥": -0.5, "두부": -0.7, "순두부": -0.7,
    "죽": -0.6, "떡": -0.5, "옥수수": -0.6, "감자": -0.6, "단호박": -0.4,
    "푸딩": -0.8, "생크림": -0.8, "딸기": -0.3, "나주배": -0.4, "사과": -0.4,
}


@dataclass
class TasteProfile:
    spicy: float
    salty: float
    soup: float
    texture: float
    aroma: float
    course: str
    confidence: float
    matched_terms: str

    def as_dict(self) -> dict:
        return asdict(self)


def _clamp(value: float) -> float:
    return round(min(SCORE_MAX, max(SCORE_MIN, value)), 2)


def _collect(text: str, table: dict[str, float]) -> list[tuple[str, float]]:
    """text 안에 등장하는 사전 항목을 모두 모은다.

    '낙지볶음'처럼 '낙지볶음'과 '볶음'이 동시에 걸리는 겹침이 흔하다. 긴 키를
    먼저 확정하고, 이미 채택한 키에 포함되는 짧은 키는 이중 계상하지 않는다.
    """
    hits: list[tuple[str, float]] = []
    taken: list[str] = []
    for key in sorted(table, key=len, reverse=True):
        if key not in text:
            continue
        if any(key in t for t in taken):
            continue
        taken.append(key)
        hits.append((key, table[key]))
    return hits


def score_menu(menu_name: str, ingredient: str = "") -> TasteProfile:
    """메뉴명(+매칭된 제철 식재료)으로 5축 점수를 낸다.

    ingredient는 seasonal_region_mapping.csv의 match_term이다. 메뉴명이
    '전복'처럼 짧아 정보가 부족할 때 식감·향의 근거를 보강해 준다.
    """
    menu = normalize_menu(menu_name)
    haystack = f"{menu} {ingredient}".strip()
    course = classify_course(menu)

    method_hits = _collect(haystack, SOUP_ANCHORS)
    spicy_hits = _collect(haystack, SPICY_DELTAS)
    salty_hits = _collect(haystack, SALTY_DELTAS)
    texture_hits = _collect(haystack, TEXTURE_ANCHORS)
    aroma_hits = _collect(haystack, AROMA_DELTAS)

    # --- soup: 앵커 중 가장 강한 하나 ---
    if method_hits:
        soup = max(v for _, v in method_hits)
    else:
        soup = 2.5
    if course in ("디저트", "음료"):
        # 빙수·라떼에 국물 점수를 주면 '국물 선호' 사용자에게 음료가 올라온다.
        soup = 1.0

    # --- spicy / salty: 베이스 + 델타 누적 ---
    spicy = 2.0 + sum(v for _, v in spicy_hits)
    salty = 3.0 + sum(v for _, v in salty_hits)
    if course in ("디저트", "음료"):
        spicy, salty = 1.0, 1.0

    # --- texture: 재료 앵커 평균, 없으면 조리법으로 대충 ---
    if texture_hits:
        # 가장 특징적인(=가장 긴 키) 재료에 무게를 더 준다.
        weights = [len(k) for k, _ in texture_hits]
        texture = sum(v * w for (_, v), w in zip(texture_hits, weights)) / sum(weights)
    else:
        texture = 3.0

    # --- aroma: 베이스 + 델타 ---
    aroma = 2.0 + sum(v for _, v in aroma_hits)

    # --- 신뢰도 ---
    # 조리법과 재료를 모두 짚었으면 룰이 제 몫을 한 것으로 본다.
    has_method = bool(method_hits)
    has_ingredient = bool(texture_hits or aroma_hits)
    confidence = 0.30
    if has_method and has_ingredient:
        confidence = 0.85
    elif has_method or has_ingredient:
        confidence = 0.55
    if course in ("디저트", "음료"):
        # 디저트·음료는 맵기/짠맛/국물이 규칙적으로 정해져 불확실성이 작다.
        confidence = max(confidence, 0.70)
    if len(menu) < 3:
        confidence -= 0.15
    if not is_menu_like(menu_name):
        confidence = 0.10
    confidence = round(min(0.95, max(0.05, confidence)), 2)

    matched = sorted({k for k, _ in (method_hits + texture_hits + aroma_hits)})

    return TasteProfile(
        spicy=_clamp(spicy),
        salty=_clamp(salty),
        soup=_clamp(soup),
        texture=_clamp(texture),
        aroma=_clamp(aroma),
        course=course,
        confidence=confidence,
        matched_terms=";".join(matched),
    )
