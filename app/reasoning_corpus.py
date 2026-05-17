from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_CORPUS_PATH = DATA_DIR / "reasoning_corpus.json"


def _normalize_key(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    normalized = re.sub(r"\s*/\s*.*$", "", normalized)
    normalized = re.sub(r"[^0-9a-z\u3400-\u9fff]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


@lru_cache(maxsize=4)
def load_reasoning_corpus(corpus_path: str = str(DEFAULT_CORPUS_PATH)) -> Dict[str, Any]:
    path = Path(corpus_path)
    if not path.exists():
        return {
            "version": "missing",
            "observation_rules": {},
            "category_guidance": {},
            "object_type_guidance": {},
            "object_facts": {},
            "llm_prompt_notes": [],
        }
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def corpus_exists(corpus_path: str = str(DEFAULT_CORPUS_PATH)) -> bool:
    return Path(corpus_path).exists()


def _direction_from_azimuth(azimuth: Any) -> str:
    try:
        value = float(azimuth) % 360.0
    except (TypeError, ValueError):
        return "未知方向"
    directions = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
    return directions[round(value / 45.0) % len(directions)]


def _fact_for_object(item: Dict[str, Any], corpus: Dict[str, Any]) -> Optional[Dict[str, str]]:
    facts = corpus.get("object_facts", {})
    candidates = [
        item.get("id"),
        item.get("name_en"),
        item.get("display_name"),
        item.get("name_zh"),
    ]
    for candidate in candidates:
        key = _normalize_key(candidate)
        if key in facts:
            return facts[key]

    name = _normalize_key(item.get("name_en") or item.get("display_name"))
    for key, value in facts.items():
        normalized_key = _normalize_key(key)
        if normalized_key and (normalized_key in name or name in normalized_key):
            return value
    return None


def _generic_tip(item: Dict[str, Any], corpus: Dict[str, Any]) -> str:
    category = str(item.get("category") or "")
    object_type = str(item.get("object_type") or "")
    category_tip = corpus.get("category_guidance", {}).get(category, {}).get("default_tip")
    type_tip = corpus.get("object_type_guidance", {}).get(object_type)
    return type_tip or category_tip or "先确认方位，再根据高度角向上寻找。"


def _magnitude_note(item: Dict[str, Any], corpus: Dict[str, Any]) -> str:
    rules = corpus.get("observation_rules", {}).get("magnitude", {})
    try:
        magnitude = float(item.get("magnitude"))
    except (TypeError, ValueError):
        return ""
    if magnitude <= 1.5:
        return rules.get("bright", "")
    if magnitude <= 3.0:
        return rules.get("normal", "")
    return rules.get("dim", "")


def _altitude_note(item: Dict[str, Any], corpus: Dict[str, Any]) -> str:
    rules = corpus.get("observation_rules", {}).get("altitude", {})
    try:
        altitude = float(item.get("altitude_deg"))
    except (TypeError, ValueError):
        return ""
    if altitude >= 55.0:
        return rules.get("high", "")
    if altitude >= 25.0:
        return rules.get("medium", "")
    return rules.get("low", "")


def _object_insight(item: Dict[str, Any], corpus: Dict[str, Any]) -> Dict[str, Any]:
    name = item.get("display_name") or item.get("name_zh") or item.get("name_en") or item.get("id") or "天体"
    fact = _fact_for_object(item, corpus) or {}
    direction = _direction_from_azimuth(item.get("azimuth_deg"))
    altitude = item.get("altitude_deg")
    category = item.get("category")
    return {
        "id": item.get("id"),
        "name": name,
        "category": category,
        "object_type": item.get("object_type"),
        "direction": direction,
        "altitude_deg": altitude,
        "azimuth_deg": item.get("azimuth_deg"),
        "magnitude": item.get("magnitude"),
        "fact": fact.get("fact") or "",
        "viewing_tip": fact.get("tip") or _generic_tip(item, corpus),
        "altitude_note": _altitude_note(item, corpus),
        "magnitude_note": _magnitude_note(item, corpus) if category != "planet" else "",
    }


def build_reasoning_context(chart: Dict[str, Any], corpus_path: str = str(DEFAULT_CORPUS_PATH)) -> Dict[str, Any]:
    corpus = load_reasoning_corpus(corpus_path)
    objects = list(chart.get("objects") or [])
    counts = chart.get("counts") or {}
    observer = chart.get("observer") or {}
    top_objects = objects[:5]
    high_objects = [item for item in objects if float(item.get("altitude_deg") or 0.0) >= 55.0]
    low_objects = [item for item in objects if 0.0 <= float(item.get("altitude_deg") or 0.0) < 25.0]
    planets = [item for item in objects if item.get("category") == "planet"]
    deep_sky = [item for item in objects if item.get("category") == "deep_sky"]

    if top_objects:
        first = top_objects[0]
        first_name = first.get("display_name") or first.get("name_en") or first.get("id") or "首选目标"
        summary = (
            f"当前位置纬度 {observer.get('lat')}、经度 {observer.get('lon')}，"
            f"本次筛选得到 {len(objects)} 个适合星图展示的目标。"
            f"建议优先提示 {first_name}，它位于{_direction_from_azimuth(first.get('azimuth_deg'))}方，"
            f"高度角约 {first.get('altitude_deg')} 度。"
        )
    else:
        summary = "当前筛选条件下没有返回适合展示的天体，建议放宽亮度阈值或降低最低高度角。"

    top_names = [
        str(item.get("display_name") or item.get("name_zh") or item.get("name_en") or item.get("id"))
        for item in top_objects
        if item
    ]
    planet_names = [
        str(item.get("display_name") or item.get("name_en") or item.get("id"))
        for item in planets[:4]
    ]

    bullets: List[str] = []
    bullets.append(
        f"类别分布：亮星 {counts.get('star', 0)} 个，行星 {counts.get('planet', 0)} 个，深空目标 {counts.get('deep_sky', 0)} 个。"
    )
    if high_objects:
        bullets.append(f"有 {len(high_objects)} 个目标高度角超过55度，可作为更稳定的首选观测对象。")
    if low_objects:
        bullets.append(f"有 {len(low_objects)} 个目标低于25度，需要提醒用户注意地平遮挡和大气消光。")
    if planet_names:
        bullets.append(f"当前行星目标可优先回答：{'、'.join(planet_names)}。")
    if deep_sky:
        bullets.append("结果包含深空天体，回答时应同步说明暗天空、双筒镜或望远镜条件。")
    if top_names:
        bullets.append(f"推荐展示顺序：{'、'.join(top_names)}。")

    insights = [_object_insight(item, corpus) for item in objects[:10]]
    return {
        "corpus_version": corpus.get("version", "unknown"),
        "summary": summary,
        "bullets": bullets,
        "object_insights": insights,
        "llm_prompt_notes": corpus.get("llm_prompt_notes", []),
    }
