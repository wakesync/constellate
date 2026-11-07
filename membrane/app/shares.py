"""Exact scoped shares: share / read / revoke a literal, owner-approved text to a named reader set.

Separate from /remember + /recall on purpose:
  - share text is NEVER written to the memories table, never embedded, never reachable via /recall,
    /graph or any LLM synthesis. It is returned byte-exact only to the owner or a listed reader.
  - authorization is enforced here, inside the enclave, on every read (not cached).
  - revoke is owner-only, idempotent, and hard-deletes the text (secure_delete on).
Identity is the signed X-Swarm-User (same HMAC scheme as every other route).
"""
from __future__ import annotations

import hashlib
import secrets
import time

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from app.main import _lock, app, conn, scope_from_headers

USER = r"^[A-Za-z0-9_.:@-]{1,64}$"
MAX_READERS = 16


def _init():
    with _lock:
        c = conn()
        c.execute("PRAGMA secure_delete = ON")
        c.execute(
            """CREATE TABLE IF NOT EXISTS shares(
                 id TEXT PRIMARY KEY, owner TEXT NOT NULL, context TEXT NOT NULL,
                 text TEXT NOT NULL, sha256 TEXT NOT NULL, created REAL NOT NULL)"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS share_readers(
                 share TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                 reader TEXT NOT NULL, PRIMARY KEY(share, reader))"""
        )
        c.commit()


_init()


class ShareIn(BaseModel):
    context: str = Field(..., pattern=r"^[A-Za-z0-9_.:@-]{1,96}$", description="caller-chosen namespace, e.g. constellate circle id")
    text: str = Field(..., min_length=1, max_length=4000)
    readers: list[str] = Field(..., min_length=1, max_length=MAX_READERS)


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@app.post("/shares")
def create_share(body: ShareIn, owner: str = Depends(scope_from_headers)):
    import re
    readers = sorted({r for r in body.readers if r != owner})
    if not readers or any(not re.fullmatch(USER, r) for r in readers):
        raise HTTPException(400, "readers must be valid ids other than the owner")
    sid = "shr_" + secrets.token_urlsafe(18)
    with _lock:
        c = conn()
        c.execute("INSERT INTO shares VALUES(?,?,?,?,?,?)", (sid, owner, body.context, body.text, _digest(body.text), time.time()))
        c.executemany("INSERT INTO share_readers VALUES(?,?)", [(sid, r) for r in readers])
        c.commit()
    return {"id": sid, "sha256": _digest(body.text), "readers": readers, "context": body.context}


@app.get("/shares/{share_id}")
def read_share(share_id: str, caller: str = Depends(scope_from_headers)):
    with _lock:
        row = conn().execute("SELECT owner, context, text, sha256 FROM shares WHERE id=?", (share_id,)).fetchone()
        allowed = row is not None and (
            caller == row[0]
            or conn().execute("SELECT 1 FROM share_readers WHERE share=? AND reader=?", (share_id, caller)).fetchone() is not None
        )
    # Same 404 for missing, revoked and unauthorized: ids are not probeable.
    if not allowed:
        raise HTTPException(404, "no such share")
    return {"id": share_id, "owner": row[0], "context": row[1], "text": row[2], "sha256": row[3]}


@app.delete("/shares/{share_id}")
def revoke_share(share_id: str, caller: str = Depends(scope_from_headers)):
    with _lock:
        c = conn()
        row = c.execute("SELECT owner FROM shares WHERE id=?", (share_id,)).fetchone()
        if row is None:
            return {"id": share_id, "revoked": True}  # idempotent
        if row[0] != caller:
            raise HTTPException(404, "no such share")
        c.execute("DELETE FROM share_readers WHERE share=?", (share_id,))
        c.execute("DELETE FROM shares WHERE id=?", (share_id,))
        c.commit()
    return {"id": share_id, "revoked": True}


@app.delete("/shares/{share_id}/readers/{reader}")
def drop_reader(share_id: str, reader: str, caller: str = Depends(scope_from_headers)):
    """Owner removes one reader (e.g. member left the circle). Idempotent."""
    with _lock:
        c = conn()
        row = c.execute("SELECT owner FROM shares WHERE id=?", (share_id,)).fetchone()
        if row is not None and row[0] != caller:
            raise HTTPException(404, "no such share")
        c.execute("DELETE FROM share_readers WHERE share=? AND reader=?", (share_id, reader))
        c.commit()
    return {"id": share_id, "reader": reader, "removed": True}
