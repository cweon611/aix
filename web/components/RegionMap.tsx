export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: "street" | "restaurant";
  /** 강조할 마커. 라벨을 항상 띄운다. */
  highlight?: boolean;
}

/**
 * 좌표를 그대로 투영한 SVG 산점도.
 *
 * 지도 타일 서비스를 쓰지 않는 이유: 카카오·네이버 지도는 API 키가 필요하고,
 * OSM 타일은 외부 네트워크에 의존한다. 여기서 필요한 건 "어디쯤 모여 있는가"
 * 하나뿐이라, 좌표만으로 그리는 편이 키도 네트워크도 없이 정확하다.
 * 실제 길찾기는 각 항목의 외부 지도 링크가 맡는다.
 */
export function RegionMap({
  markers,
  height = 260,
}: {
  markers: MapMarker[];
  height?: number;
}) {
  const points = markers.filter(
    (m) => Number.isFinite(m.lat) && Number.isFinite(m.lon),
  );

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-line bg-accent-soft text-sm text-fg-muted"
        style={{ height }}
      >
        좌표 정보가 없어 지도를 그릴 수 없습니다
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  // 점이 하나뿐이면 폭이 0이 되어 나눗셈이 깨진다. 최소 범위를 준다.
  const pad = 0.06;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;

  const W = 600;
  const H = Math.max(160, height);
  // 위도가 올라갈수록 경도 1도의 실제 거리가 줄어든다. 중위도 기준으로 보정.
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const spanLon = (maxLon - minLon) * lonScale;
  const spanLat = maxLat - minLat;
  const scale = Math.min(W / spanLon, H / spanLat);
  const offsetX = (W - spanLon * scale) / 2;
  const offsetY = (H - spanLat * scale) / 2;

  const project = (lat: number, lon: number) => ({
    x: offsetX + (lon - minLon) * lonScale * scale,
    // SVG는 y가 아래로 자라므로 위도를 뒤집는다.
    y: offsetY + (maxLat - lat) * scale,
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-2xl border border-line"
      style={{ height, background: "#dbe2de" }}
      role="img"
      aria-label={`추천 지점 ${points.length}곳의 위치 지도`}
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1"
            opacity="0.45"
          />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {points
        // 강조 마커를 마지막에 그려 다른 점 위로 올린다.
        .slice()
        .sort((a, b) => Number(Boolean(a.highlight)) - Number(Boolean(b.highlight)))
        .map((m) => {
          const { x, y } = project(m.lat, m.lon);
          const isStreet = m.kind === "street";
          const r = m.highlight ? 9 : isStreet ? 7 : 4.5;

          // 라벨은 기본으로 점 오른쪽에 붙이되, 오른쪽 끝에서 잘릴 것 같으면
          // 왼쪽으로 넘긴다. 한글은 폭이 거의 글자당 14px이다.
          const labelWidth = m.label.length * 14 + 18;
          const flip = x + 12 + labelWidth > W;
          const labelX = flip ? x - 12 - labelWidth : x + 12;

          return (
            <g key={m.id}>
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={isStreet ? "#b23a22" : "#1f5f52"}
                stroke="#ffffff"
                strokeWidth={m.highlight ? 3 : 2}
              />
              {m.highlight && (
                <>
                  <rect
                    x={labelX}
                    y={y - 13}
                    width={labelWidth}
                    height={26}
                    rx={13}
                    fill="#1c1815"
                    opacity="0.92"
                  />
                  <text
                    x={labelX + labelWidth / 2}
                    y={y + 5}
                    fill="#fbf8f3"
                    fontSize="14"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {m.label}
                  </text>
                </>
              )}
            </g>
          );
        })}
    </svg>
  );
}
