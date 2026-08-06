"""메뉴명에서 취향 지표 네 가지를 산출하는 룰 엔진.

지표
----
- spicy            0 안 매움 / 1 약간 / 2 매움 / 3 아주 매움
- has_soup         국물 요리인가 (True/False)
- is_raw           날것으로 먹는가 (True/False)
- main_ingredients 주재료 분류 — 해산물 | 육류 | 채소
                   대표 재료 하나만 붙이되, 두 계열이 이름에서 맞부딪히면
                   (전복삼계탕, 낙지불고기, 소고기순두부) 둘 다 붙인다.

설계 원칙
---------
조리법이 국물 유무와 맵기를 결정하고, 재료명이 주재료 분류와 날것 여부를
결정한다. 그래서 사전을 조리법 계열과 재료 계열로 나눠 두었다.

신뢰도(confidence)는 "조리법과 재료를 각각 짚었는가"로 매긴다. 0.6 미만은
사람이 직접 매기는 대상이다(manual_labels.py).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict

# 주재료 분류. "채소"는 식물성 전반(곡물·과일·버섯 포함)을 뜻한다.
SEAFOOD = "해산물"
MEAT = "육류"
VEGGIE = "채소"
CATEGORIES = (SEAFOOD, MEAT, VEGGIE)

SPICY_MIN, SPICY_MAX = 0, 3


# --------------------------------------------------------------------------
# 정규화
# --------------------------------------------------------------------------

_TRAILING_NOISE = re.compile(r"[\s,/·]*(등|외|기타)\s*$")
_BRACKETS = re.compile(r"[（(\[][^）)\]]*[）)\]]?")
_PRICE_NOTE = re.compile(r"※.*$")
_MULTISPACE = re.compile(r"\s+")
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
    for _ in range(2):
        text = _TRAILING_NOISE.sub("", text).strip()
    return text


def is_menu_like(name: str) -> bool:
    text = normalize_menu(name)
    if len(text) < 2 or len(text) > 40:
        return False
    return not _NOT_A_MENU.search(text)


# --------------------------------------------------------------------------
# 코스 — 디저트·음료는 맵기와 국물을 따질 대상이 아니다.
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
_COURSE_OVERRIDE_MEAL = (
    "떡국", "떡갈비", "떡볶이", "물떡", "쌀떡", "치즈떡",
    "죽순떡갈비", "오리떡갈비", "닭떡갈비", "유황오리떡갈비",
)
# 차·음료 계열인데 위 사전에 안 걸리는 이름들. 룰이 "차"를 못 잡아 식사로
# 넘기던 항목들이라 따로 적어 둔다.
_EXPLICIT_DRINKS = (
    "대추차", "유자차", "생강차", "쑥차", "잎차", "통차", "도라지차", "배차",
    "오미자", "한라봉", "매실차", "구기자",
)


def classify_course(menu_norm: str) -> str:
    """'식사' | '디저트' | '음료'."""
    for kw in _EXPLICIT_DRINKS:
        if kw in menu_norm:
            return "음료"
    for kw in _COURSE_OVERRIDE_MEAL:
        if kw in menu_norm:
            return "식사"
    for kw in DRINK_KEYWORDS:
        if kw in menu_norm:
            return "음료"
    for kw in DESSERT_KEYWORDS:
        if kw in menu_norm:
            return "디저트"
    return "식사"


# --------------------------------------------------------------------------
# 국물 — 조리법이 정하고, 가장 강한 신호 하나를 채택한다.
# --------------------------------------------------------------------------

SOUP_KEYWORDS = (
    "연포탕", "매운탕", "지리", "간국", "해신탕", "탕", "국밥", "곰탕", "삼계탕",
    "육개장", "찌개", "전골", "샤브", "뚝배기", "국", "칼국수", "수제비", "라면",
    "짬뽕", "쌀국수", "물회", "떡국", "죽", "해장국", "백숙", "곰국",
)
# 위 키워드를 품고 있어도 국물 요리가 아닌 것들. "탕탕이"가 대표 사례다.
NO_SOUP_OVERRIDE = (
    "탕탕이", "탕수육", "탕평채", "설렁탕면", "국수전골",
)
# 이름에 국물 키워드가 없어도 국물이 있는 것.
EXTRA_SOUP = ("국수", "냉면", "우동", "메밀국수")
# 국수류 중 비빔은 국물이 없다.
NOODLE_NO_SOUP = ("비빔", "짜장", "쟁반", "골동면", "초계")


def detect_soup(text: str) -> tuple[bool, bool]:
    """(국물 여부, 조리법을 짚었는지) 를 돌려준다."""
    for kw in NO_SOUP_OVERRIDE:
        if kw in text:
            return False, True
    for kw in SOUP_KEYWORDS:
        if kw in text:
            return True, True
    for kw in EXTRA_SOUP:
        if kw in text:
            if any(x in text for x in NOODLE_NO_SOUP):
                return False, True
            return True, True
    # 국물이 없다고 확실히 말할 수 있는 조리법
    for kw in ("구이", "회", "무침", "전", "튀김", "볶음", "찜", "조림", "밥",
               "정식", "백반", "쌈밥", "보쌈", "수육", "장", "젓갈", "숙회",
               "사시미", "초밥", "샤브샤브용"):
        if kw in text:
            return False, True
    return False, False


# --------------------------------------------------------------------------
# 맵기 0~3
# --------------------------------------------------------------------------

SPICY_3 = ("아주 매운", "매운", "얼큰", "불닭", "화끈", "땡초", "청양")
SPICY_2 = (
    "고추장", "매콤", "아귀찜", "매운탕", "육개장", "짬뽕", "떡볶이", "낙지볶음",
    "주꾸미", "볶음", "무침", "양념", "제육", "주물럭", "비빔", "코다리조림",
    "닭발", "쭈꾸미",
)
SPICY_1 = (
    "김치", "묵은지", "갓김치", "조림", "찜", "초무침", "회무침", "짱뚱어",
    "칠게장", "낙지전골", "순두부", "청국장",
)
# 확실히 맵지 않다고 말할 수 있는 신호. 위 사전에 걸려도 이쪽이 이긴다.
NOT_SPICY = (
    "지리", "간장", "백숙", "수육", "샤브", "죽", "구이", "회", "사시미",
    "숙회", "물회", "전복죽", "곰탕", "설렁", "맑은", "하얀", "초밥",
)


def detect_spicy(text: str, course: str) -> tuple[int, bool]:
    """(맵기 0~3, 근거를 짚었는지)."""
    if course in ("디저트", "음료"):
        return 0, True

    level = None
    for kw in SPICY_3:
        if kw in text:
            level = 3
            break
    if level is None:
        for kw in SPICY_2:
            if kw in text:
                level = 2
                break
    if level is None:
        for kw in SPICY_1:
            if kw in text:
                level = 1
                break

    # 맑은 국물·간장 양념 신호가 있으면 한 단계 내린다.
    if any(kw in text for kw in NOT_SPICY):
        if level is None:
            return 0, True
        return max(0, level - 1), True

    if level is None:
        return 0, False
    return level, True


# --------------------------------------------------------------------------
# 날것 여부
# --------------------------------------------------------------------------

RAW_KEYWORDS = (
    "회", "사시미", "물회", "탕탕이", "산낙지", "세발낙지", "육회", "생굴",
    "초밥", "게장", "젓갈", "젓", "홍어", "멍게", "해삼", "기절낙지", "생선회",
    "활어", "선어", "다짐", "세꼬시", "생물",
)
# "회"를 품지만 익힌 것.
NOT_RAW_OVERRIDE = (
    "숙회", "회무침전골", "회덮밥탕", "구이", "튀김", "전골", "찜", "탕",
    "국", "찌개", "볶음", "조림", "샤브", "라면", "죽", "만두",
)
# 위 예외에 걸려도 여전히 날것인 조합.
RAW_STRONG = ("산낙지", "탕탕이", "생굴", "육회", "물회", "사시미", "홍어회", "세꼬시")


def detect_raw(text: str, course: str) -> tuple[bool, bool]:
    """(날것 여부, 근거를 짚었는지)."""
    if course in ("디저트", "음료"):
        return False, True
    for kw in RAW_STRONG:
        if kw in text:
            return True, True
    if any(kw in text for kw in NOT_RAW_OVERRIDE):
        return False, True
    for kw in RAW_KEYWORDS:
        if kw in text:
            return True, True
    return False, False


# --------------------------------------------------------------------------
# 주재료 분류
# --------------------------------------------------------------------------

INGREDIENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    SEAFOOD: (
        "세발낙지", "산낙지", "낙지", "전복", "갈치", "꼬막", "새꼬막", "참꼬막",
        "꽃게", "홍어", "굴비", "보리굴비", "조기", "굴", "아귀", "병어", "바지락",
        "고등어", "삼치", "붕장어", "장어", "하모", "민어", "키조개", "오징어",
        "갑오징어", "주꾸미", "쭈꾸미", "새우", "대하", "문어", "우럭", "농어",
        "도다리", "방어", "전어", "매생이", "톳", "해초", "멸치", "다슬기",
        "짱뚱어", "대구", "멍게", "해삼", "서대", "코다리", "명태", "미역",
        # 한 글자 '김'은 김치·김밥까지 잡아 두부김치를 해산물로 만든다.
        "돌김", "물김", "김가루", "김구이",
        "백합", "소라", "게장", "칠게", "해물", "해산물", "생선", "회", "우렁이",
        "우렁", "가리비", "홍합", "대게", "붕어", "메기", "빠가", "미꾸라지", "추어",
    ),
    MEAT: (
        "한우", "소고기", "쇠고기", "돼지고기", "삼겹살", "목살", "차돌", "육회",
        "오리", "닭", "토종닭", "흑염소", "곱창", "대창", "막창", "떡갈비",
        "불고기", "제육", "수육", "보쌈", "갈비", "삼계탕", "백숙", "주물럭",
        "육개장", "고기", "돈까스", "스테이크", "베이컨", "햄", "닭가슴살",
        "암돼지", "유황오리", "한우암소",
    ),
    VEGGIE: (
        "도토리", "죽순", "애호박", "순두부", "두부", "콩", "나물", "산채", "시금치",
        "능이", "표고", "버섯", "미나리", "배추", "열무", "시래기", "들깨",
        "보리", "쌀", "메밀", "우리밀", "감자", "고구마", "옥수수", "단호박",
        "가지", "토마토", "유자", "매실", "대추", "도라지", "더덕", "쑥",
        "딸기", "산딸기", "무화과", "배", "사과", "복숭아", "멜론", "팥",
        "녹두", "마늘", "생강", "곰보배추", "쌈밥", "김치", "묵은지", "고추",
        "채소", "야채", "흑미", "한라봉", "청포도", "블루베리", "오디", "자두",
        "석류", "곶감", "밤", "연잎", "바질", "샐러드",
        # '떡'·'면'·'비빔밥'은 조리 형태이지 재료가 아니다. 넣으면 떡갈비·
        # 낙지비빔밥까지 채소로 끌려온다.
    ),
}


def detect_ingredients(text: str) -> tuple[list[str], bool]:
    """(주재료 분류 목록, 근거를 짚었는지).

    두 계열이 이름에서 맞부딪히면 둘 다 남긴다. 전복삼계탕은 해산물이면서
    육류이고, 사용자가 어느 쪽으로 찾아와도 나와야 맞다.
    """
    hits: dict[str, int] = {}
    for category, keywords in INGREDIENT_KEYWORDS.items():
        best = 0
        for kw in keywords:
            if kw in text:
                best = max(best, len(kw))
        if best:
            hits[category] = best

    if not hits:
        return [], False

    ranked = sorted(hits.items(), key=lambda kv: -kv[1])
    top_score = ranked[0][1]
    chosen = {ranked[0][0]}

    # 두 번째 계열도 이름에서 충분히 뚜렷하면(대표 재료와 같은 급이면) 함께 남긴다.
    for category, score in ranked[1:]:
        if score >= top_score - 1:
            chosen.add(category)
        if len(chosen) == 2:
            break

    # 순서를 CATEGORIES 기준으로 고정한다. "해산물;채소"와 "채소;해산물"이
    # 따로 집계되면 분포를 읽을 수 없다.
    return [c for c in CATEGORIES if c in chosen], True


# --------------------------------------------------------------------------
@dataclass
class TasteProfile:
    spicy: int
    has_soup: bool
    is_raw: bool
    main_ingredients: list[str]
    course: str
    confidence: float

    def as_dict(self) -> dict:
        return asdict(self)


def score_menu(menu_name: str, ingredient: str = "") -> TasteProfile:
    """메뉴명(+매칭된 제철 식재료)으로 취향 지표를 낸다."""
    menu = normalize_menu(menu_name)
    haystack = f"{menu} {ingredient}".strip()
    course = classify_course(menu)

    spicy, spicy_sure = detect_spicy(haystack, course)
    has_soup, soup_sure = detect_soup(haystack)
    is_raw, raw_sure = detect_raw(haystack, course)
    ingredients, ing_sure = detect_ingredients(haystack)

    if course in ("디저트", "음료"):
        has_soup = False

    # 맵기와 날것은 "표시가 없으면 아니다"가 맞는 기본값이다. 매운 음식에는
    # 대개 매움·볶음·양념이 붙고, 날것에는 회·산낙지·게장이 붙는다. 그래서
    # 키워드를 못 찾은 것 자체를 근거 부족으로 치지 않는다.
    # 반면 국물 유무는 조리법을 짚어야만 알 수 있어 이쪽만 근거로 센다.
    _ = (spicy_sure, raw_sure)
    method_sure = soup_sure
    if method_sure and ing_sure:
        confidence = 0.85
    elif method_sure or ing_sure:
        confidence = 0.55
    else:
        confidence = 0.30

    if course in ("디저트", "음료"):
        confidence = max(confidence, 0.70)
    if len(menu) < 3:
        confidence -= 0.15
    if not is_menu_like(menu_name):
        confidence = 0.10

    return TasteProfile(
        spicy=max(SPICY_MIN, min(SPICY_MAX, spicy)),
        has_soup=has_soup,
        is_raw=is_raw,
        main_ingredients=ingredients,
        course=course,
        confidence=round(min(0.95, max(0.05, confidence)), 2),
    )
