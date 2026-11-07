"""Prompt contract shared by teacher, student SFT formatting, eval and serving.

NATAL_SYSTEM is the production reading prompt (server/src/inference.ts SYSTEM, with
DISCLAIMER prepended), so the student is trained on exactly the task it will serve.
PAIR_SYSTEM is the relationship-reading prompt, including the circle-memory input
(prior themes from the Cognee circle graph, see docs/CIRCLE-MEMORY.md).
"""
from __future__ import annotations

import json

DISCLAIMER = (
    "Astrology is an interpretive practice for reflection and entertainment, not scientifically "
    "validated prediction or medical, financial, or diagnostic advice."
)

NATAL_SYSTEM = (
    f"{DISCLAIMER} Write a warm reflective astrology reading of 350-550 words from only the supplied "
    "placements. Interpretations are invitations, not facts about a person. Never diagnose, predict events, "
    "prescribe treatment, recommend investments, or offer medical, financial or relationship directives. "
    "Never invent houses, aspects, ascendant, or other placements. If timeKnown is false, explain all "
    "placements are noon estimates, the Moon can vary substantially and signs near boundaries are uncertain. "
    "Include three grounded reflection questions. Plain text, short paragraphs."
)

PAIR_SYSTEM = (
    f"{DISCLAIMER} Write a reflective relationship reading of 250-400 words for two people, using only the "
    "supplied placements, shared features and aspects. Frame it for the stated relationship. Romantic framing "
    "is allowed only when romanticOptIn is true; otherwise never describe the pair romantically. Name where "
    "they flow, where they may clash, and one concrete way to talk about the clash. If priorThemes is "
    "non-empty, these are themes earlier circle readings surfaced for this same pair: build on them briefly "
    "rather than repeating them. Never invent houses, ascendant or aspects not given. No directives, no "
    "predictions. End with two reflection questions they could ask each other. Plain text, short paragraphs."
)


def messages_for(row: dict) -> list[dict]:
    """The exact chat the model sees. Only placements/features, never birth data."""
    if row["task"] == "natal":
        return [{"role": "system", "content": NATAL_SYSTEM},
                {"role": "user", "content": json.dumps(row["input"], separators=(",", ":"))}]
    i = row["input"]

    def side(s: dict) -> dict:
        keep = ("body", "sign", "degree", "house", "retrograde")
        out = {"name": s["name"], "timeKnown": s["timeKnown"], "placements": [{k: p[k] for k in keep if k in p} for p in s["placements"]]}
        for k in ("zodiac", "ascendant", "midheaven"):
            if k in s:
                out[k] = s[k]
        return out

    slim = {
        "a": side(i["a"]),
        "b": side(i["b"]),
        "relationship": i["relationship"], "romanticOptIn": i["romanticOptIn"],
        "shared": i["features"]["shared"], "aspects": i["features"]["aspects"], "priorThemes": i["priorThemes"],
    }
    return [{"role": "system", "content": PAIR_SYSTEM},
            {"role": "user", "content": json.dumps(slim, separators=(",", ":"))}]
