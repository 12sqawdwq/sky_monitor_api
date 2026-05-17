from __future__ import annotations

import os
from datetime import datetime
from html import escape
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, model_validator

from app.astronomy import build_answer_facts, build_sky_chart, build_spoken_answer
from app.catalog_query import get_bright_stars, get_catalog_stats, get_star_by_name
from app.db import database_exists
from app.reasoning_corpus import load_reasoning_corpus


PUBLIC_BASE_URL = os.getenv("SKY_PUBLIC_BASE_URL", "https://sky.eunoia.top").rstrip("/")

app = FastAPI(
    title="Rokid Sky Assistant",
    version="0.3.1",
    description="Local astronomy catalog backend for GPS-based sky charts, facts, and voice Q&A.",
    servers=[
        {
            "url": PUBLIC_BASE_URL,
            "description": "Lingzhu public HTTPS endpoint",
        }
    ],
)


class CoordinateRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

    @model_validator(mode="before")
    @classmethod
    def normalize_coordinate_aliases(cls, values: Any) -> Any:
        if isinstance(values, dict):
            normalized = dict(values)
            if "lat" not in normalized and "latitude" in normalized:
                normalized["lat"] = normalized["latitude"]
            if "lon" not in normalized and "longitude" in normalized:
                normalized["lon"] = normalized["longitude"]
            return normalized
        return values


class SkyFactsRequest(CoordinateRequest):
    time_utc: Optional[datetime] = None
    max_mag: float = Field(default=3.0, le=6.0)
    star_limit: int = Field(default=10, ge=1, le=20)
    min_altitude_deg: float = Field(default=15.0, ge=-90.0, le=90.0)
    include_planets: bool = True

    @model_validator(mode="before")
    @classmethod
    def normalize_facts_aliases(cls, values: Any) -> Any:
        values = super().normalize_coordinate_aliases(values)
        if isinstance(values, dict):
            normalized = dict(values)
            if "max_mag" not in normalized and "max_magnitude" in normalized:
                normalized["max_mag"] = normalized["max_magnitude"]
            return normalized
        return values


class SkyAskRequest(SkyFactsRequest):
    question: Optional[str] = None


class SkyChartRequest(CoordinateRequest):
    time_utc: Optional[datetime] = None
    star_max_mag: float = Field(default=3.0, le=6.0)
    deep_sky_max_mag: float = Field(default=9.0, ge=0.0, le=12.0)
    min_altitude_deg: float = Field(default=15.0, ge=0.0, le=90.0)
    total_limit: int = Field(default=28, ge=8, le=60)
    include_planets: bool = True
    include_deep_sky: bool = True

    @model_validator(mode="before")
    @classmethod
    def normalize_chart_aliases(cls, values: Any) -> Any:
        values = super().normalize_coordinate_aliases(values)
        if isinstance(values, dict):
            normalized = dict(values)
            if "star_max_mag" not in normalized and "max_magnitude" in normalized:
                normalized["star_max_mag"] = normalized["max_magnitude"]
            return normalized
        return values


def _build_facts(payload: SkyFactsRequest) -> Dict[str, Any]:
    return build_answer_facts(
        lat=payload.lat,
        lon=payload.lon,
        observed_at=payload.time_utc,
        max_mag=payload.max_mag,
        star_limit=payload.star_limit,
        min_altitude_deg=payload.min_altitude_deg,
        include_planets=payload.include_planets,
    )


def _build_chart(payload: SkyChartRequest) -> Dict[str, Any]:
    return build_sky_chart(
        lat=payload.lat,
        lon=payload.lon,
        observed_at=payload.time_utc,
        star_max_mag=payload.star_max_mag,
        deep_sky_max_mag=payload.deep_sky_max_mag,
        min_altitude_deg=payload.min_altitude_deg,
        total_limit=payload.total_limit,
        include_planets=payload.include_planets,
        include_deep_sky=payload.include_deep_sky,
    )


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "version": app.version,
        "catalog_db_exists": database_exists(),
    }


@app.get("/wiki", response_class=HTMLResponse)
def wiki(request: Request) -> HTMLResponse:
    base_url = escape(str(request.base_url).rstrip("/"))
    example_body = """{
  "latitude": 31.2304,
  "longitude": 121.4737,
  "min_altitude_deg": 15,
  "max_magnitude": 3,
  "deep_sky_max_mag": 9,
  "total_limit": 28
}"""
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lingzhu Sky API Wiki</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #5c6674;
      --line: #dfe4ec;
      --code: #111827;
      --accent: #2563eb;
    }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    main {{
      max-width: 920px;
      margin: 0 auto;
      padding: 40px 20px 56px;
    }}
    h1, h2 {{
      line-height: 1.25;
      margin: 0 0 14px;
    }}
    h1 {{
      font-size: 30px;
    }}
    h2 {{
      margin-top: 34px;
      font-size: 20px;
      border-top: 1px solid var(--line);
      padding-top: 24px;
    }}
    p, li {{
      color: var(--muted);
    }}
    code {{
      background: #eef2f7;
      border: 1px solid var(--line);
      border-radius: 5px;
      padding: 1px 5px;
      color: var(--code);
    }}
    pre {{
      overflow: auto;
      background: #111827;
      color: #f9fafb;
      padding: 16px;
      border-radius: 8px;
      line-height: 1.5;
    }}
    pre code {{
      background: transparent;
      border: 0;
      color: inherit;
      padding: 0;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
      background: var(--panel);
    }}
    th, td {{
      border: 1px solid var(--line);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }}
    th {{
      background: #eef2f7;
    }}
    .base {{
      display: inline-block;
      color: var(--accent);
      font-weight: 700;
      word-break: break-all;
    }}
  </style>
</head>
<body>
<main>
  <h1>Lingzhu Sky API Wiki</h1>
  <p>当前服务根地址：<span class="base">{base_url}</span></p>
  <p>对接平台时填写 HTTPS 域名即可，不需要追加端口。推荐主接口是 <code>POST /sky/chart</code>。</p>

  <h2>灵珠导入方式</h2>
  <p>在灵珠平台导入 OpenAPI 时填写下面这个地址，schema 内的服务地址已固定为 <code>https://sky.eunoia.top</code>，不会回退成 IP。</p>
  <pre><code>https://sky.eunoia.top/openapi.json</code></pre>
  <p>导入后选择 <code>POST /sky/chart</code> 作为主动作。对话侧只需要让平台传入 GPS 坐标；其他字段可以不传，后端会使用默认筛选规则。</p>

  <h2>健康检查</h2>
  <pre><code>curl "{base_url}/health"</code></pre>

  <h2>标准调用</h2>
  <pre><code>curl -X POST "{base_url}/sky/chart" \\
  -H "Content-Type: application/json" \\
  -d '{escape(example_body)}'</code></pre>

  <h2>请求字段</h2>
  <table>
    <thead><tr><th>字段</th><th>必填</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td><code>latitude</code></td><td>是</td><td>GPS 纬度，范围 -90 到 90。也兼容 <code>lat</code>。</td></tr>
      <tr><td><code>longitude</code></td><td>是</td><td>GPS 经度，范围 -180 到 180。也兼容 <code>lon</code>。</td></tr>
      <tr><td><code>time_utc</code></td><td>否</td><td>UTC 时间，例如 <code>2026-05-16T03:15:00Z</code>。不传则使用当前时间。</td></tr>
      <tr><td><code>min_altitude_deg</code></td><td>否</td><td>恒星和深空天体最低高度角，默认 15。</td></tr>
      <tr><td><code>max_magnitude</code></td><td>否</td><td>恒星亮度阈值，默认 3。也兼容 <code>star_max_mag</code>。</td></tr>
      <tr><td><code>deep_sky_max_mag</code></td><td>否</td><td>深空天体亮度阈值，默认 9，知名星团星云星系会放宽。</td></tr>
      <tr><td><code>total_limit</code></td><td>否</td><td>返回目标数量，默认 28，范围 8 到 60。</td></tr>
    </tbody>
  </table>

  <h2>返回结构</h2>
  <pre><code>{{
  "sky_chart": {{
    "observer": {{"lat": 31.2304, "lon": 121.4737}},
    "time_utc": "2026-05-16T03:15:27Z",
    "coordinate_system": {{ "...": "..." }},
    "constraints": {{ "...": "..." }},
    "counts": {{"star": 12, "planet": 4, "deep_sky": 6}},
    "objects": [
      {{
        "category": "star",
        "object_type": "star",
        "display_name": "五车二",
        "azimuth_deg": 51.35,
        "altitude_deg": 58.95,
        "magnitude": 0.08,
        "chart_x": 0.2694,
        "chart_y": 0.2155,
        "chart_radius": 0.345,
        "selection_reason": "bright_star_mag_lte_3_alt_gte_15"
      }}
    ]
  }}
}}</code></pre>

  <h2>GET 调试方式</h2>
  <pre><code>curl "{base_url}/sky/chart?lat=31.2304&amp;lon=121.4737&amp;total_limit=8"</code></pre>

  <h2>接口文档</h2>
  <p>OpenAPI 调试页：<a href="{base_url}/docs">{base_url}/docs</a></p>
</main>
</body>
</html>"""
    return HTMLResponse(html)


@app.post("/sky/chart")
def sky_chart(payload: SkyChartRequest) -> Dict[str, Any]:
    try:
        return {"sky_chart": _build_chart(payload)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/sky/chart")
def sky_chart_get(
    lat: Optional[float] = Query(default=None, ge=-90.0, le=90.0),
    lon: Optional[float] = Query(default=None, ge=-180.0, le=180.0),
    latitude: Optional[float] = Query(default=None, ge=-90.0, le=90.0),
    longitude: Optional[float] = Query(default=None, ge=-180.0, le=180.0),
    time_utc: Optional[datetime] = None,
    star_max_mag: float = Query(default=3.0, le=6.0),
    deep_sky_max_mag: float = Query(default=9.0, ge=0.0, le=12.0),
    min_altitude_deg: float = Query(default=15.0, ge=0.0, le=90.0),
    total_limit: int = Query(default=28, ge=8, le=60),
    include_planets: bool = True,
    include_deep_sky: bool = True,
) -> Dict[str, Any]:
    resolved_lat = lat if lat is not None else latitude
    resolved_lon = lon if lon is not None else longitude
    if resolved_lat is None or resolved_lon is None:
        raise HTTPException(status_code=422, detail="lat/lon or latitude/longitude are required")
    payload = SkyChartRequest(
        lat=resolved_lat,
        lon=resolved_lon,
        time_utc=time_utc,
        star_max_mag=star_max_mag,
        deep_sky_max_mag=deep_sky_max_mag,
        min_altitude_deg=min_altitude_deg,
        total_limit=total_limit,
        include_planets=include_planets,
        include_deep_sky=include_deep_sky,
    )
    try:
        return {"sky_chart": _build_chart(payload)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sky/facts")
def sky_facts(payload: SkyFactsRequest) -> Dict[str, Any]:
    try:
        return {"answer_facts": _build_facts(payload)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/sky/facts")
def sky_facts_get(
    lat: Optional[float] = Query(default=None, ge=-90.0, le=90.0),
    lon: Optional[float] = Query(default=None, ge=-180.0, le=180.0),
    latitude: Optional[float] = Query(default=None, ge=-90.0, le=90.0),
    longitude: Optional[float] = Query(default=None, ge=-180.0, le=180.0),
    time_utc: Optional[datetime] = None,
    max_mag: float = Query(default=3.0, le=6.0),
    star_limit: int = Query(default=10, ge=1, le=20),
    min_altitude_deg: float = Query(default=15.0, ge=-90.0, le=90.0),
    include_planets: bool = True,
) -> Dict[str, Any]:
    resolved_lat = lat if lat is not None else latitude
    resolved_lon = lon if lon is not None else longitude
    if resolved_lat is None or resolved_lon is None:
        raise HTTPException(status_code=422, detail="lat/lon or latitude/longitude are required")
    payload = SkyFactsRequest(
        lat=resolved_lat,
        lon=resolved_lon,
        time_utc=time_utc,
        max_mag=max_mag,
        star_limit=star_limit,
        min_altitude_deg=min_altitude_deg,
        include_planets=include_planets,
    )
    try:
        return {"answer_facts": _build_facts(payload)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sky/ask")
def sky_ask(payload: SkyAskRequest) -> Dict[str, Any]:
    try:
        answer_facts = _build_facts(payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "answer_facts": answer_facts,
        "spoken_answer": build_spoken_answer(answer_facts),
    }


@app.get("/catalog/stats")
def catalog_stats() -> Dict[str, Any]:
    try:
        return get_catalog_stats()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/reasoning/corpus")
def reasoning_corpus() -> Dict[str, Any]:
    return load_reasoning_corpus()


@app.get("/stars/bright")
def bright_stars(limit: int = Query(default=20, ge=1, le=100)) -> Dict[str, Any]:
    try:
        stars = get_bright_stars(limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "count": len(stars),
        "stars": stars,
    }


@app.get("/stars/search")
def star_search(name: str = Query(..., min_length=1)) -> Dict[str, Any]:
    try:
        star = get_star_by_name(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if star is None:
        raise HTTPException(status_code=404, detail=f"Star not found: {name}")
    return {
        "star": star,
    }
