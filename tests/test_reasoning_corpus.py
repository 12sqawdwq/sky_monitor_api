from __future__ import annotations

from app.reasoning_corpus import build_reasoning_context, load_reasoning_corpus


def test_reasoning_corpus_loads_object_facts() -> None:
    corpus = load_reasoning_corpus()

    assert corpus["version"]
    assert "sirius" in corpus["object_facts"]
    assert corpus["llm_prompt_notes"]


def test_build_reasoning_context_uses_chart_objects() -> None:
    chart = {
        "observer": {"lat": 31.4591, "lon": 121.1298},
        "counts": {"star": 1, "planet": 1, "deep_sky": 0},
        "objects": [
            {
                "id": "Sirius",
                "category": "star",
                "object_type": "star",
                "display_name": "天狼星",
                "name_en": "Sirius",
                "altitude_deg": 58.2,
                "azimuth_deg": 155.0,
                "magnitude": -1.46,
            },
            {
                "id": "venus",
                "category": "planet",
                "object_type": "planet",
                "display_name": "Venus / 金星",
                "name_en": "Venus / 金星",
                "altitude_deg": 20.1,
                "azimuth_deg": 250.0,
            },
        ],
    }

    context = build_reasoning_context(chart)

    assert "天狼星" in context["summary"]
    assert len(context["object_insights"]) == 2
    assert context["object_insights"][0]["fact"]
    assert any("行星" in item for item in context["bullets"])
