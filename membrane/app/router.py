"""membrane router: "Free agents cost you your soul. Local agents cost you your
intelligence. We route between them."

Runs inside the membrane process (so, inside the enclave when deployed). For
every request it decides (a) how sensitive the context is and (b) how much
capability the task needs, then picks a brain and cuts the slice:

  SIGNER   credential intent (pay / charge / deploy ...). A signer in this process
           holds a scoped demo key, performs a mock action, returns a receipt.
           No model ever sees the key.
  PRIVATE  sealed memory or any unrecognized task. Private enclave recall only;
           outages fail closed to local extraction, never an external model.
  FRONTIER an allowlisted general capability task. Claude gets a fixed
           de-identified task projection with placeholder context, never raw
           query or arbitrary note prose. A leak gate checks the body text.

The classifier is deterministic: credential keywords, explicit safe-task
allowlist, member-only recall, and a private default. This is deliberately a
conservative demo policy, not a general sensitive-data classifier.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app import main as m

ENCLAVE_URL = os.environ.get("ENCLAVE_URL", "").rstrip("/")
ENCLAVE_SECRET = os.environ.get("ENCLAVE_SWARM_SECRET", "")
FRONTIER_URL = os.environ.get("FRONTIER_URL", "https://api.anthropic.com/v1/messages")
FRONTIER_MODEL = os.environ.get("FRONTIER_MODEL", "claude-opus-5-5")
FRONTIER_KEY = os.environ.get("FRONTIER_API_KEY", "") or m.LLM_API_KEY
DEMO_MODE = os.environ.get("ROUTER_DEMO", "0") == "1"
PRIVATE_MIN_SIM = float(os.environ.get("ROUTER_PRIVATE_MIN_SIM", "0.30"))
SIGNER_ORG = os.environ.get("SIGNER_ORG", "demo-workspace")
# clearly fake, minted per process, never written to disk, never sent to a model
SIGNER_KEY = "sk_demo_" + secrets.token_hex(16)

# fictional demo directory: user id -> display name (used for scrubbing)
DIRECTORY = {
    "odessa": "Odessa Vane", "pim": "Pim Okafor", "juno": "Juno Reyes",
    "wren": "Wren Halloway", "tal": "Tal Brenner", "kai": "Kai Moreno",
}
EXTRA_ENTITIES = ["Brightline Electric"]

INVOICES = {
    SIGNER_ORG: [{"id": "INV-2207", "vendor": "Demo vendor", "for": "project services",
                      "amount_usd": 3180.00, "due": "2026-11-15", "status": "open"}],
}

CRED = re.compile(r"\b(pay|paid|payment|invoice|charge|refund|deploy|transfer|wire|send money|sign the|"
                  r"api key|secret key|credential|withdraw)\b", re.I)
CAPABILITY = re.compile(r"\b(draft|write|rewrite|structure|argument|argue|outline|pitch|essay|grant|"
                        r"brainstorm|explain|summari[sz]e|plan|design|help me)\b", re.I)
RECALL_INTENT = re.compile(r"\b(what did|who|when|decide|decided|said|say|budget|how much|which)\b", re.I)

_log: list[dict] = []
_llock = threading.Lock()


class RouteIn(BaseModel):
    user: str = Field(..., pattern=r"^[A-Za-z0-9_.:@-]{1,64}$")
    query: str = Field(..., min_length=1, max_length=600)


# ---------------------------------------------------------------- scrub
def _entities() -> list[tuple[str, str]]:
    """(surface form, placeholder) longest first."""
    with m._lock:
        orgs = m.conn().execute("SELECT id, name FROM orgs").fetchall()
        users = {r[0] for r in m.conn().execute("SELECT user FROM members")}
    ents: list[tuple[str, str]] = []
    for oid, name in orgs:
        ents += [(name, "[org]"), (oid, "[org]")]
        first = name.split()[0]
        if len(first) > 3:
            ents.append((first, "[org]"))
    for u in users | set(DIRECTORY):
        full = DIRECTORY.get(u, u)
        ents.append((full, "[person]"))
        ents += [(part, "[person]") for part in full.split() if len(part) > 2]
        ents.append((u, "[person]"))
    ents += [(e, "[org]") for e in EXTRA_ENTITIES]
    return sorted(set(ents), key=lambda x: -len(x[0]))


MONEY = re.compile(r"(\$|usd\s?)\s?\d[\d,]*(\.\d+)?(?:\s?[kKmM])?\b|\b\d[\d,]*(\.\d+)?\s?(dollars|usd)\b", re.I)
CODE = re.compile(r"\b[A-Z]{2,}(-[A-Z0-9]+)+\b")
DIGITS = re.compile(r"\b\d[\d,.:/-]*\b")
KEYS = re.compile(r"\b(sk|rk|pk)_[A-Za-z0-9_]{6,}")


def scrub_slice(s: str) -> str:
    s = KEYS.sub("[key]", s)
    s = m.scrub(s)
    s = re.sub(r"\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+){2,}\b", "[code]", s)
    s = CODE.sub("[code]", s)
    s = MONEY.sub("[amount]", s)
    s = DIGITS.sub("[number]", s)
    for surf, ph in _entities():
        s = re.sub(rf"(?<![\w-]){re.escape(surf)}(?![\w-])", ph, s, flags=re.I)
    s = re.sub(r"(\[(\w+)\])(\s*\1)+", r"\1", s)  # collapse "[person] [person]"
    return s


def sealed_tokens() -> set[str]:
    """Everything sensitive in member-only memory: the leak gate's blocklist."""
    with m._lock:
        rows = m.conn().execute(
            "SELECT m.text FROM memories m LEFT JOIN orgs o ON o.id=m.org "
            "WHERE m.org IS NULL OR o.wall != 'open-derived'").fetchall()
    toks: set[str] = set()
    for (t,) in rows:
        toks |= {x.group(0) for x in CODE.finditer(t)}
        toks |= {x.group(0).strip() for x in MONEY.finditer(t)}
        toks |= {x for x in DIGITS.findall(t) if len(x.strip(",.")) >= 2}
        toks |= set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", t))
    toks |= {surf for surf, _ in _entities() if len(surf) > 2}
    toks.add(SIGNER_KEY)
    return {t for t in toks if t}


def gate(payload: str) -> list[str]:
    low = payload.lower()
    hits = []
    for t in sealed_tokens():
        if re.search(rf"(?<![\w-]){re.escape(t.lower())}(?![\w-])", low):
            hits.append(t)
    return hits


# ---------------------------------------------------------------- memory access
def member_hits(user: str, query: str, k: int = 5) -> list[dict]:
    mine = m.my_orgs(user)
    where = "(org IS NULL AND scope=?)" + (f" OR org IN ({m._inq(mine)})" if mine else "")
    return m.backend.search(query, k, where, (user, *sorted(mine)))


def org_walls() -> dict:
    with m._lock:
        return dict(m.conn().execute("SELECT id, wall FROM orgs").fetchall())


# ---------------------------------------------------------------- brains
def _sign(user: str) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(ENCLAVE_SECRET.encode(), f"{user}.{ts}".encode(), hashlib.sha256).hexdigest()
    return {"X-Swarm-User": user, "X-Swarm-Ts": ts, "X-Swarm-Sig": sig, "Content-Type": "application/json"}


def enclave_attestation() -> dict:
    if not ENCLAVE_URL:
        return {"available": False, "note": "no enclave configured"}
    try:
        r = httpx.get(f"{ENCLAVE_URL}/attestation", timeout=8)
        r.raise_for_status()
        return {"available": True, "url": ENCLAVE_URL, "response": r.json()}
    except Exception as e:
        return {"available": False, "url": ENCLAVE_URL, "note": f"unavailable ({type(e).__name__})"}


def degenerate(a: str | None) -> bool:
    if not a or len(a.strip()) < 8:
        return True
    alnum = sum(ch.isalnum() for ch in a) / max(1, len(a))
    return alnum < 0.4 or bool(re.search(r"(.)\1{15,}", a))


def redact_credentials(text: str) -> str:
    for key in (SIGNER_KEY, m.LLM_API_KEY, FRONTIER_KEY, ENCLAVE_SECRET, m.SWARM_SECRET):
        if key and len(key) > 8:
            text = text.replace(key, "[key]")
    text = re.sub(r"\b(?:sk|rk|pk)_[A-Za-z0-9_-]+", "[key]", text)
    text = re.sub(r"\b(?:ghp_|github_pat_|AKIA|AIza)[A-Za-z0-9_-]+", "[key]", text)
    text = re.sub(r"(?i)\b(bearer|password|api[_ -]?key|token|credential)(?:\s*[:=]\s*|\s+)[A-Za-z0-9_./+=-]+", r"\1 [key]", text)
    return text


def private_brain(user: str, query: str, hits: list[dict]) -> dict:
    query = redact_credentials(query)
    body = json.dumps({"query": query}).encode()
    att = enclave_attestation()
    note = None
    if ENCLAVE_URL and ENCLAVE_SECRET:
        try:
            r = httpx.post(f"{ENCLAVE_URL}/recall", content=body, headers=_sign(user), timeout=120)
            r.raise_for_status()
            j = r.json()
            if not degenerate(j.get("answer")) and j.get("mode") != "empty":
                return {"label": "private (Tinfoil enclave, qwen3.8-27b on H200)", "stand_in": False,
                        "destination": f"{ENCLAVE_URL}/recall", "outbound_payload": body.decode(),
                        "answer": redact_credentials(j["answer"]), "enclave_mode": j.get("mode"), "attestation": att,
                        "outbound_requests": [{"destination": ENCLAVE_URL + "/recall", "body": body.decode()}]}
            note = f"enclave answered but model output unusable (mode={j.get('mode')})"
        except Exception as e:
            note = f"enclave recall failed ({type(e).__name__})"
    else:
        note = "no enclave configured"
    # FAIL CLOSED: a private-backend outage never relaxes the permitted
    # destination. Local extractive answer only, with no fallback model request.
    attempted = bool(ENCLAVE_URL and ENCLAVE_SECRET)
    answer = m.extractive_answer(query, hits) if hits else "No authorized context matches this question."
    return {"label": f"private unavailable ({note}); local extractive answer, no cloud fallback",
            "stand_in": True, "destination": ENCLAVE_URL + "/recall" if attempted else None,
            "outbound_payload": body.decode() if attempted else None,
            "outbound_requests": [{"destination": ENCLAVE_URL + "/recall", "body": body.decode()}] if attempted else [],
            "answer": redact_credentials(answer), "attestation": att}


FRONTIER_SYSTEM = ("You are a capable writing and reasoning assistant. The user's context has been "
                   "privacy-scrubbed: placeholders like [person], [org], [amount], [number] stand for real "
                   "values you will never see. Keep the placeholders as-is in your answer. Be concise.")


def frontier_brain(query: str, hits: list[dict]) -> dict:
    # A narrow purpose-built slice, not arbitrary sealed prose. Raw note text
    # never enters this branch's model payload. Grant work gets a public-safe
    # abstraction, with entity slots, selected from the permitted org context.
    # Closed-vocabulary task projection. Do not send arbitrary user prose,
    # even when regexes cannot recognize its sensitive content.
    sq = "Help me write a project proposal. Use placeholders for people, budget and dates."
    ctx = "- Project owner: [person]. Budget: [amount]. Timeline: [number]. Contact: [email]."
    user_msg = f"TASK: {sq}\n\nCONTEXT (scrubbed):\n{ctx}"
    body = {"model": FRONTIER_MODEL, "max_tokens": 700, "system": FRONTIER_SYSTEM,
            "messages": [{"role": "user", "content": user_msg}]}
    raw = json.dumps(body, ensure_ascii=False)
    blocked = gate(FRONTIER_SYSTEM + "\n" + user_msg)  # gate the text, not JSON framing like max_tokens
    if blocked:
        # never send. tokens are reported by COUNT only.
        return {"label": "frontier BLOCKED by leak gate", "blocked": len(blocked), "outbound_payload": None,
                "destination": None, "answer": "leak gate stopped this slice; nothing left the enclave."}
    ans = None
    attempts = [{"destination": "Claude /v1/messages", "body": raw}]
    fallback = False
    template = False
    try:
        r = httpx.post(FRONTIER_URL, content=raw.encode(), timeout=90, headers={
            "content-type": "application/json", "anthropic-version": "2023-06-01",
            "x-api-key": FRONTIER_KEY, "authorization": f"Bearer {FRONTIER_KEY}"})
        r.raise_for_status()
        ans = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()
    except Exception as e:
        ans = f"(Claude unavailable: {type(e).__name__})"
        # Availability fallback uses the SAME scrubbed slice, never raw notes.
        fallback = True
        fb = {"model": m.LLM_MODEL, "max_tokens": 600, "messages": [
            {"role": "system", "content": FRONTIER_SYSTEM}, {"role": "user", "content": user_msg}]}
        raw = json.dumps(fb, ensure_ascii=False)
        attempts.append({"destination": "frontier stand-in /chat/completions", "body": raw})
        try:
            rr = httpx.post(m.LLM_BASE_URL + "/chat/completions", content=raw.encode(), timeout=60,
                            headers={"Authorization": f"Bearer {m.LLM_API_KEY}", "Content-Type": "application/json"})
            rr.raise_for_status()
            ans = rr.json()["choices"][0]["message"]["content"]
        except Exception as e2:
            if re.search(r"\b(grant|proposal)\b", query, re.I):
                template = True
                ans = ("Local template, not model-generated: This project seeks [amount] to test a focused "
                       "solution to a clearly defined problem. Led by [person], the work will proceed "
                       "through research, a small pilot, and an evaluation over [number] weeks. "
                       "The proposal should state who benefits, what success means, and how results will be shared.")
            else:
                ans += f"; stand-in unavailable ({type(e2).__name__})"
    return {"label": "frontier unavailable (local proposal template; no model answer)" if template else
                        f"frontier (stand-in: {m.LLM_MODEL}; Claude unavailable)" if fallback else
                        f"frontier ({FRONTIER_MODEL}, scrubbed slice)", "outbound_payload": raw,
            "outbound_requests": attempts, "stand_in": fallback,
            "destination": "frontier stand-in /chat/completions" if fallback else "Claude via pool /v1/messages",
            "answer": ans, "blocked": 0}


_ledger: list[dict] = []
_signer_lock = threading.Lock()


def signer(user: str, query: str) -> dict:
    with _signer_lock:
        return _signer_impl(user, query)


def _signer_impl(user: str, query: str) -> dict:
    mine = m.my_orgs(user)
    if SIGNER_ORG not in mine:
        return {"label": "signer (refused)", "outbound_payload": None, "destination": None,
                "answer": "Mock signer refused: the key is scoped to one org and you are not a member. No money moved.",
                "receipt": {"status": "refused", "scope": "single org", "reason": "not a member"}}
    if not re.search(r"\b(pay|payment)\b", query, re.I) or not re.search(r"\binvoice\b", query, re.I):
        return {"label": "signer (unsupported action)", "outbound_payload": None, "destination": None,
                "answer": "demo signer only supports paying its pre-approved invoice; no action performed.",
                "receipt": {"status": "refused", "reason": "action outside demo allowlist"}}
    inv = next((i for i in INVOICES.get(SIGNER_ORG, []) if i["status"] == "open"), None)
    if not inv:
        previous = next((item for item in reversed(_ledger) if item['org'] == SIGNER_ORG), None)
        if previous:
            return {"label": "signer (mock receipt replay; no new action)", "outbound_payload": None,
                    "destination": "none: previous in-process mock receipt",
                    "answer": "This demo invoice was already paid in the mock ledger. Returning its receipt; no new action, no money moved.",
                    "receipt": {**previous, "status": "already paid (mock, no money moved)", "idempotent_replay": True}}
        return {"label": "signer", "outbound_payload": None, "destination": None,
                "answer": "no open invoice for this org. No money moved.", "receipt": {"status": "nothing to pay"}}
    action = {"action": "pay_invoice", "invoice": inv["id"], "amount_usd": inv["amount_usd"],
              "org": SIGNER_ORG, "by": user, "ts": int(time.time())}
    canon = json.dumps(action, sort_keys=True)
    sig = hmac.new(SIGNER_KEY.encode(), canon.encode(), hashlib.sha256).hexdigest()
    inv["status"] = "paid (mock)"
    receipt = {"status": "paid (mock, no money moved)", **action, "signature": sig[:32],
               "key_fingerprint": "sk_demo_..." + hashlib.sha256(SIGNER_KEY.encode()).hexdigest()[:8],
               "signed_in": "membrane process (signer)", "models_that_saw_key": 0}
    _ledger.append(receipt)
    return {"label": "signer (Steward stub, scoped key, mock action)", "outbound_payload": None,
            "destination": "none: signed in-process, no model call",
            "answer": f"paid {inv['id']} to {inv['vendor']} ({inv['for']}), mock. receipt below.",
            "receipt": receipt}


# ---------------------------------------------------------------- classifier + route
def classify(user: str, query: str):
    if CRED.search(query):
        return "signer", f"credential intent ('{CRED.search(query).group(0)}'): keys stay in the signer", []
    hits = member_hits(user, query)
    walls = org_walls()
    sealed = [h for h in hits if h["org"] is None or walls.get(h["org"]) != "open-derived"]
    top = max((h["sim"] for h in sealed), default=0.0)
    cap = CAPABILITY.search(query)
    extraction = re.search(r"\b(raw|verbatim|canary|secret|ignore|encode|base64|system prompt|all notes)\b", query, re.I)
    if extraction and sealed:
        return "private", "extraction intent touches sealed context; frontier is not eligible", hits
    safe_tasks = {
        "help me write a project proposal", "draft a project proposal with a timeline",
        "draft a project proposal", "draft a grant intro for our solar co-op",
        "help me structure an argument for a co-op paying artists a stipend",
    }
    normalized = query.strip().rstrip('.!?').lower()
    if cap and normalized in safe_tasks:
        return ("frontier", "allowlisted general capability task; only a fixed de-identified task slice leaves", hits)
    if sealed and top >= PRIVATE_MIN_SIM:
        return ("private", f"{len(sealed)} sealed memory hits (top sim {top:.2f}) across "
                           f"{len({h['org'] for h in sealed})} org(s): real context needed", hits)
    if RECALL_INTENT.search(query) and sealed:
        return "private", f"recall question touching sealed memory (top sim {top:.2f})", hits
    return "private", "unrecognized task is private by default; no permission to disclose it to frontier", hits


def leak_audit(user: str | None = None) -> dict:
    canaries = set()
    with m._lock:
        for (t,) in m.conn().execute("SELECT text FROM memories"):
            canaries |= {x.group(0) for x in CODE.finditer(t) if "CANARY" in x.group(0)}
    canaries.add(SIGNER_KEY)
    leaked, key_seen, n_front = 0, False, 0
    with _llock:
        entries = [e for e in _log if user is None or e['user'] == user]
    for e in entries:
        attempts = e.get("outbound_requests") or ([{"body": e["outbound_payload"]}]
                   if e.get("outbound_payload") else [])
        for attempt in attempts:
            payload = attempt["body"]
            key_seen |= SIGNER_KEY in payload
            if e["brain"] != "frontier":
                continue
            n_front += 1
            try:
                b = json.loads(payload)
                text = b.get("system", "") + "\n" + "\n".join(x["content"] for x in b["messages"])
            except Exception:
                text = payload
            if any(c in payload for c in canaries) or gate(text):
                leaked += 1
    return {"secrets_leaked_to_frontier": leaked, "frontier_payloads": n_front,
            "signer_key_in_any_outbound_payload": key_seen, "canaries_tracked": len(canaries)}


@m.app.post("/route")
def route(body: RouteIn, request: Request):
    if DEMO_MODE:
        if body.user != "juno":
            raise HTTPException(403, "public demo only allows the fictional juno identity")
    else:
        signed = m.scope_from_headers(request.headers.get("x-swarm-user", ""),
                                      request.headers.get("x-swarm-ts", ""), request.headers.get("x-swarm-sig", ""))
        if signed != body.user:
            raise HTTPException(403, "user must match authenticated identity")
    t0 = time.time()
    body.query = redact_credentials(body.query)
    brain, reason, hits = classify(body.user, body.query)
    if brain == "signer":
        out = signer(body.user, body.query)
    elif brain == "private":
        out = private_brain(body.user, body.query, hits)
    else:
        out = frontier_brain(body.query, hits)
    entry = {"ts": int(t0), "user": body.user, "query": body.query, "brain": brain, "reason": reason,
             "label": out.get("label"), "destination": out.get("destination"),
             "outbound_payload": out.get("outbound_payload"), "answer": out.get("answer"),
             "attestation": out.get("attestation"), "receipt": out.get("receipt"),
             "router_attested": False, "attestation_scope": "remote memory service only; router is not attested",
             "execution": "mock" if brain == "signer" else "attempted" if out.get("outbound_payload") else "local-only",
             "stand_in": out.get("stand_in", False), "outbound_requests": out.get("outbound_requests", []), "ms": int((time.time() - t0) * 1000)}
    with _llock:
        _log.append(entry)
        if len(_log) > 500:
            del _log[:-500]
    return {**entry, "audit": leak_audit(body.user)}


@m.app.get("/route/log")
def route_log(request: Request):
    user = "juno" if DEMO_MODE else m.scope_from_headers(
        request.headers.get("x-swarm-user", ""), request.headers.get("x-swarm-ts", ""),
        request.headers.get("x-swarm-sig", ""))
    with _llock:
        items = [x for x in _log if x["user"] == user]
    return {"decisions": items, "audit": leak_audit(user)}


@m.app.get("/router.html")
def router_html():
    return FileResponse(m.WEB_DIR / "router.html")


@m.app.get("/router")
def router_page():
    return FileResponse(m.WEB_DIR / "router.html")
