"""Permissioned circle knowledge graph on Cognee (self-hosted, in-enclave).

One graph per circle context (the same `context` string exact shares use, e.g.
`cst:<circle id>`), stored as Cognee DataPoints:

    CircleMember  --authored-->  ApprovedSummary  --about-->  CircleTheme
    CircleReading --between--> CircleMember,  --surfaced--> CircleTheme,
                  --drew_on--> ApprovedSummary

Permission rules, enforced HERE inside the enclave, not by the caller:
  * Only approved content enters. POST /summaries takes a share id, not text:
    the text is read from the exact-share table, and only if the caller owns
    that share in this context. Readings store closed-vocabulary theme labels
    plus provenance (which approved shares they drew on), never reading text.
  * Revoke removes. A summary whose share is gone (DELETE /shares/{id}, or an
    explicit DELETE /members/{m}) is purged with every reading that drew on it,
    the member node, and orphaned themes. Purge also runs lazily before every
    read, so a revoke through the shares API alone is enough.
  * Reads follow grants. Only an owner or listed reader of an active share in
    the context can read the graph; summary text is returned only for shares
    the caller may read. Prior themes are returned only to a pair member.

Cognee is optional at import time (the default image does not ship it). If it
is missing, the routes return 503 and the app server keeps its own SQLite
circle graph (server/src/circle-graph.ts), which implements the same rules.
Cognee's low-level DataPoint API needs no LLM or embedding calls for this:
nodes are written with empty index_fields, so nothing leaves the enclave.
"""
from __future__ import annotations

import asyncio
import os
import re
import threading
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from app.main import _lock, app, conn, scope_from_headers

CTX = r"^[A-Za-z0-9_.:@-]{1,96}$"
USER = r"^[A-Za-z0-9_.:@-]{1,64}$"
NS = uuid.uuid5(uuid.NAMESPACE_URL, "constellate:circle-graph")

# Same closed vocabulary as server/src/circle-graph.ts THEMES.
THEMES = {
    "communication": r"\b(communicat\w*|talk\w*|listen\w*|conversation\w*|mercury|words?|express\w*)\b",
    "emotional needs": r"\b(emotion\w*|feel\w*|moon|nurtur\w*|comfort\w*|sensitiv\w*|care\w*)\b",
    "conflict and drive": r"\b(conflict\w*|clash\w*|mars|anger|tension\w*|drive|push\w*|friction)\b",
    "affection and values": r"\b(venus|affection\w*|values?|warmth|apprecia\w*|generos\w*)\b",
    "identity": r"\b(identity|sun|self|confiden\w*|purpose|ego)\b",
    "structure and routine": r"\b(routine\w*|structure\w*|saturn|plan\w*|schedule\w*|discipline|chores?|morning)\b",
    "growth and adventure": r"\b(growth|jupiter|adventur\w*|explor\w*|travel\w*|optimis\w*)\b",
    "creativity": r"\b(creativ\w*|art|paint\w*|music|play\w*|imagin\w*|neptune|build\w*)\b",
    "independence": r"\b(independen\w*|space|freedom|uranus|alone|autonom\w*)\b",
}


def extract_themes(text: str) -> list[str]:
    return [t for t, rx in THEMES.items() if re.search(rx, text, re.I)]


def nid(*parts: str) -> uuid.UUID:
    return uuid.uuid5(NS, "\x1f".join(parts))


class _Cognee:
    """Lazy cognee handle with a private event loop (FastAPI sync routes run in a pool)."""

    def __init__(self):
        os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")  # enclave HMAC auth is the gate
        os.environ.setdefault("CACHING", "false")
        os.environ.setdefault("TELEMETRY_DISABLED", "1")
        root = os.environ.get("COGNEE_ROOT", "/data/cognee")
        os.environ.setdefault("SYSTEM_ROOT_DIRECTORY", f"{root}/system")
        os.environ.setdefault("DATA_ROOT_DIRECTORY", f"{root}/data")
        # membrane's DB_PATH (its sqlite FILE) collides with cognee's DB_PATH setting
        # (a DIRECTORY). Hide it while cognee builds its cached configs.
        saved = os.environ.pop("DB_PATH", None)
        try:
            self._init_cognee()
        finally:
            if saved is not None:
                os.environ["DB_PATH"] = saved

    def _init_cognee(self):
        import cognee  # noqa: F401
        from cognee.low_level import DataPoint, setup
        from cognee.tasks.storage import add_data_points
        from cognee.infrastructure.databases.graph import get_graph_engine

        class CircleMember(DataPoint):
            name: str
            circle: str
            metadata: dict = {"index_fields": []}

        class CircleTheme(DataPoint):
            name: str
            circle: str
            metadata: dict = {"index_fields": []}

        class ApprovedSummary(DataPoint):
            name: str
            circle: str
            share_id: str
            text: str
            authored_by: CircleMember
            about: list[CircleTheme] = []
            metadata: dict = {"index_fields": []}

        class CircleReading(DataPoint):
            name: str
            circle: str
            pair_a: str
            pair_b: str
            between: list[CircleMember] = []
            surfaced: list[CircleTheme] = []
            drew_on: list[ApprovedSummary] = []
            metadata: dict = {"index_fields": []}

        self.T = dict(CircleMember=CircleMember, CircleTheme=CircleTheme, ApprovedSummary=ApprovedSummary, CircleReading=CircleReading)
        self.add_data_points, self.get_graph_engine = add_data_points, get_graph_engine
        self.loop = asyncio.new_event_loop()
        self.lock = threading.Lock()
        self.run(setup())

    def run(self, coro):
        with self.lock:
            return self.loop.run_until_complete(coro)

    async def _nodes(self, circle: str):
        g = await self.get_graph_engine()
        nodes, edges = await g.get_graph_data()
        mine = {str(i): p for i, p in nodes if p.get("circle") == circle}
        rel = [(str(s), str(t), r) for s, t, r, *_ in edges if str(s) in mine and str(t) in mine]
        return g, mine, rel


_cg: _Cognee | None = None
_cg_err: str | None = None


def cg() -> _Cognee:
    global _cg, _cg_err
    if _cg is None and _cg_err is None:
        try:
            _cg = _Cognee()
        except Exception as e:  # pragma: no cover - depends on image
            _cg_err = type(e).__name__
            if os.environ.get("CIRCLE_GRAPH_DEBUG"):
                raise
    if _cg is None:
        raise HTTPException(503, "circle graph backend unavailable")
    return _cg


# ---------------------------------------------------------------- grants (exact-share table is the source of truth)
def _active_shares(ctx: str) -> dict[str, dict]:
    with _lock:
        rows = conn().execute("SELECT id, owner, text FROM shares WHERE context=?", (ctx,)).fetchall()
        readers = conn().execute(
            "SELECT r.share, r.reader FROM share_readers r JOIN shares s ON s.id=r.share WHERE s.context=?", (ctx,)
        ).fetchall()
    out = {sid: {"owner": o, "text": t, "readers": set()} for sid, o, t in rows}
    for sid, r in readers:
        out[sid]["readers"].add(r)
    return out


def _may_read(share: dict, who: str) -> bool:
    return who == share["owner"] or who in share["readers"]


def _require_member(ctx: str, who: str, shares: dict) -> None:
    if not any(_may_read(s, who) for s in shares.values()):
        raise HTTPException(404, "no such circle graph")


async def _purge(c: _Cognee, ctx: str, active: dict) -> None:
    """Drop every summary whose share is no longer active, plus everything derived from it."""
    g, nodes, rel = await c._nodes(ctx)
    dead_summaries = {i for i, p in nodes.items() if p.get("type") == "ApprovedSummary" and p.get("share_id") not in active}
    if not dead_summaries:
        return
    dead_members = {t for s, t, r in rel if s in dead_summaries and r == "authored_by"}
    live_members = {t for s, t, r in rel if s not in dead_summaries and r == "authored_by" and nodes[s].get("type") == "ApprovedSummary"}
    dead_members -= live_members
    dead_readings = {s for s, t, r in rel if nodes[s].get("type") == "CircleReading" and (t in dead_summaries or t in dead_members)}
    doomed = dead_summaries | dead_members | dead_readings
    survivors_ref = {t for s, t, r in rel if s not in doomed}
    orphans = {i for i, p in nodes.items() if p.get("type") == "CircleTheme" and i not in survivors_ref}
    await g.delete_nodes(list(doomed | orphans))


class SummaryIn(BaseModel):
    share_id: str = Field(..., pattern=r"^shr_[A-Za-z0-9_-]{8,64}$")


class ReadingIn(BaseModel):
    reading_id: str = Field(..., pattern=r"^[A-Za-z0-9_.:-]{1,96}$")
    pair: list[str] = Field(..., min_length=2, max_length=2)
    themes: list[str] = Field(default_factory=list, max_length=len(THEMES))
    sources: list[str] = Field(..., min_length=1, max_length=8)


def _ctx(ctx: str) -> str:
    if not re.fullmatch(CTX, ctx):
        raise HTTPException(400, "bad context")
    return ctx


@app.post("/circle-graph/{ctx}/summaries")
def add_summary(ctx: str, body: SummaryIn, who: str = Depends(scope_from_headers)):
    ctx = _ctx(ctx)
    shares = _active_shares(ctx)
    s = shares.get(body.share_id)
    if s is None or s["owner"] != who:
        raise HTTPException(404, "no such share")  # only the owner can add their own approved summary
    c = cg()
    T = c.T
    member = T["CircleMember"](id=nid(ctx, "m", who), name=who, circle=ctx)
    themes = [T["CircleTheme"](id=nid(ctx, "t", t), name=t, circle=ctx) for t in extract_themes(s["text"])]
    summ = T["ApprovedSummary"](id=nid(ctx, "s", body.share_id), name=f"summary:{who}", circle=ctx, share_id=body.share_id,
                                text=s["text"], authored_by=member, about=themes)

    async def go():
        await _purge(c, ctx, shares)
        await c.add_data_points([summ])
    c.run(go())
    return {"ok": True, "themes": [t.name for t in themes]}


@app.delete("/circle-graph/{ctx}/members/{member}")
def revoke_member(ctx: str, member: str, who: str = Depends(scope_from_headers)):
    ctx = _ctx(ctx)
    if who != member:
        raise HTTPException(404, "no such member")
    c = cg()
    # Treat the member's shares as gone for graph purposes, even if the share row
    # is still being revoked remotely: graph access stops first.
    active = {k: v for k, v in _active_shares(ctx).items() if v["owner"] != member}
    c.run(_purge(c, ctx, active))

    async def drop_member():  # member node with no summaries left, and readings that involve them
        g, nodes, rel = await c._nodes(ctx)
        mid = str(nid(ctx, "m", member))
        doomed = {mid} if mid in nodes else set()
        doomed |= {i for i, p in nodes.items() if p.get("type") == "CircleReading" and member in (p.get("pair_a"), p.get("pair_b"))}
        if doomed:
            await g.delete_nodes(list(doomed))
        g, nodes, rel = await c._nodes(ctx)
        ref = {t for _, t, _ in rel}
        orphans = [i for i, p in nodes.items() if p.get("type") == "CircleTheme" and i not in ref]
        if orphans:
            await g.delete_nodes(orphans)
    c.run(drop_member())
    return {"ok": True}


@app.post("/circle-graph/{ctx}/readings")
def record_reading(ctx: str, body: ReadingIn, who: str = Depends(scope_from_headers)):
    ctx = _ctx(ctx)
    a, b = sorted(body.pair)
    if who not in (a, b) or a == b or not all(re.fullmatch(USER, x) for x in (a, b)):
        raise HTTPException(403, "caller must be one of the pair")
    shares = _active_shares(ctx)
    owners = {shares[s]["owner"] for s in body.sources if s in shares}
    if any(s not in shares for s in body.sources) or not {a, b} <= owners:
        raise HTTPException(409, "reading is not grounded in both members' active approved shares")
    c = cg()
    T = c.T
    mem = [T["CircleMember"](id=nid(ctx, "m", x), name=x, circle=ctx) for x in (a, b)]
    by_owner = {x.name: x for x in mem}
    srcs = []
    for sid in sorted(set(body.sources)):
        s = shares[sid]
        srcs.append(T["ApprovedSummary"](id=nid(ctx, "s", sid), name=f"summary:{s['owner']}", circle=ctx, share_id=sid, text=s["text"],
                                         authored_by=by_owner.get(s["owner"]) or T["CircleMember"](id=nid(ctx, "m", s["owner"]), name=s["owner"], circle=ctx),
                                         about=[T["CircleTheme"](id=nid(ctx, "t", t), name=t, circle=ctx) for t in extract_themes(s["text"])]))
    themes = [T["CircleTheme"](id=nid(ctx, "t", t), name=t, circle=ctx) for t in dict.fromkeys(body.themes) if t in THEMES]
    rd = T["CircleReading"](id=nid(ctx, "r", body.reading_id), name=f"reading:{body.reading_id}", circle=ctx, pair_a=a, pair_b=b,
                            between=mem, surfaced=themes, drew_on=srcs)

    async def go():
        await _purge(c, ctx, shares)
        await c.add_data_points([rd])
    c.run(go())
    return {"ok": True, "themes": [t.name for t in themes]}


def _snapshot(c: _Cognee, ctx: str, shares: dict):
    async def go():
        await _purge(c, ctx, shares)
        return await c._nodes(ctx)
    return c.run(go())


@app.get("/circle-graph/{ctx}/prior-themes")
def prior_themes(ctx: str, a: str, b: str, limit: int = 5, who: str = Depends(scope_from_headers)):
    ctx = _ctx(ctx)
    a, b = sorted((a, b))
    if who not in (a, b):
        raise HTTPException(403, "caller must be one of the pair")
    shares = _active_shares(ctx)
    _require_member(ctx, who, shares)
    _, nodes, rel = _snapshot(cg(), ctx, shares)
    counts: dict[str, int] = {}
    for s, t, r in rel:
        p = nodes[s]
        if p.get("type") == "CircleReading" and r == "surfaced" and p.get("pair_a") == a and p.get("pair_b") == b:
            name = nodes[t]["name"]
            counts[name] = counts.get(name, 0) + 1
    return {"themes": [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))][: max(1, min(limit, 20))]}


@app.get("/circle-graph/{ctx}")
def snapshot(ctx: str, who: str = Depends(scope_from_headers)):
    ctx = _ctx(ctx)
    shares = _active_shares(ctx)
    _require_member(ctx, who, shares)
    _, nodes, rel = _snapshot(cg(), ctx, shares)
    out_edges: dict[str, list[tuple[str, str]]] = {}
    for s, t, r in rel:
        out_edges.setdefault(s, []).append((t, r))
    summaries, readings, themes = [], [], {}
    for i, p in nodes.items():
        if p.get("type") == "ApprovedSummary":
            sh = shares.get(p.get("share_id"))
            owner = next((nodes[t]["name"] for t, r in out_edges.get(i, []) if r == "authored_by"), None)
            ts = sorted(nodes[t]["name"] for t, r in out_edges.get(i, []) if r == "about")
            summaries.append({"shareId": p["share_id"], "memberId": owner, "themes": ts,
                              **({"text": p["text"]} if sh and _may_read(sh, who) else {})})
            for t in ts:
                themes.setdefault(t, {"members": set(), "readings": 0})["members"].add(owner)
        elif p.get("type") == "CircleReading":
            ts = sorted(nodes[t]["name"] for t, r in out_edges.get(i, []) if r == "surfaced")
            srcs = sorted(nodes[t]["share_id"] for t, r in out_edges.get(i, []) if r == "drew_on")
            readings.append({"readingId": p["name"].split(":", 1)[1], "pair": [p["pair_a"], p["pair_b"]], "themes": ts, "sources": srcs})
            for t in ts:
                e = themes.setdefault(t, {"members": set(), "readings": 0})
                e["readings"] += 1
                e["members"].update((p["pair_a"], p["pair_b"]))
    theme_list = sorted(({"theme": t, "members": sorted(e["members"]), "readings": e["readings"],
                          "weight": len(e["members"]) + 2 * e["readings"]} for t, e in themes.items()),
                        key=lambda x: (-x["weight"], x["theme"]))
    return {"circleId": ctx, "backend": "cognee", "members": sorted({s["memberId"] for s in summaries}),
            "summaries": sorted(summaries, key=lambda s: s["memberId"] or ""), "themes": theme_list,
            "readings": sorted(readings, key=lambda r: r["readingId"])}
