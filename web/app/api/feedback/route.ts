import { NOTE_MAX, type AccuracyVerdict, type FeedbackPayload } from "@/lib/feedback";
import { AXIS_LABELS, type AxisKey } from "@/lib/recommend";

/**
 * "이 정보가 실제와 다른가요?" 답을 받는다.
 *
 * 이 서비스에는 데이터베이스가 없다. 그래서 받은 답은 구조화된 한 줄로
 * 런타임 로그에 남긴다. 로그는 "얼마나, 어떤 메뉴에 들어오는지"를 보기 위한
 * 자리이지 쌓아 두는 자리가 아니다 — 로그는 배포 플랫폼의 보존 기간이 지나면
 * 사라진다. 반영은 사람이 읽고 src/taste/manual_labels.py에 옮기는 것으로 끝난다.
 *
 * 저장소를 붙일 때 고칠 곳은 logFeedback 한 군데다.
 */

/** 몸통이 커 봐야 이 정도다. 그보다 크면 읽지 않고 자른다. */
const MAX_BODY_BYTES = 4_000;

const AXIS_KEYS = Object.keys(AXIS_LABELS) as AxisKey[];

function isAxisKey(value: unknown): value is AxisKey {
  return typeof value === "string" && AXIS_KEYS.includes(value as AxisKey);
}

function isVerdict(value: unknown): value is AccuracyVerdict {
  return value === "same" || value === "different";
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * 클라이언트가 보낸 것을 그대로 믿지 않는다. 공개 엔드포인트라 아무나
 * 아무 모양이나 넣을 수 있고, 로그에 넣을 값은 우리가 아는 모양이어야 한다.
 */
function parse(body: unknown): FeedbackPayload | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;

  const foodId = str(raw.foodId, 80);
  if (!foodId || !isVerdict(raw.verdict)) return null;

  const shownRaw =
    raw.shown && typeof raw.shown === "object" ? (raw.shown as Record<string, unknown>) : {};

  return {
    foodId,
    foodName: str(raw.foodName, 120),
    verdict: raw.verdict,
    // 중복을 걷어 낸다. 같은 지표를 여러 번 넣어 건수를 부풀리지 못하게.
    axes: Array.isArray(raw.axes) ? [...new Set(raw.axes.filter(isAxisKey))] : [],
    note: str(raw.note, NOTE_MAX).trim(),
    shown: {
      spicy: typeof shownRaw.spicy === "number" ? shownRaw.spicy : -1,
      hasSoup: shownRaw.hasSoup === true,
      isRaw: shownRaw.isRaw === true,
      mainIngredients: Array.isArray(shownRaw.mainIngredients)
        ? shownRaw.mainIngredients.filter((v): v is string => typeof v === "string").slice(0, 4)
        : [],
      confidence: typeof shownRaw.confidence === "number" ? shownRaw.confidence : -1,
    },
  };
}

/** 저장소가 생기면 여기만 바꾸면 된다. */
function logFeedback(payload: FeedbackPayload): void {
  // 한 줄 JSON으로 남긴다. 로그를 긁어 집계할 때 줄 단위로 파싱된다.
  console.log(
    `[accuracy-feedback] ${JSON.stringify({ at: new Date().toISOString(), ...payload })}`,
  );
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const payload = parse(body);
  if (!payload) return new Response(null, { status: 400 });

  logFeedback(payload);

  // 돌려줄 것이 없다. 화면은 보냈는지 여부만 알면 된다.
  return new Response(null, { status: 204 });
}
