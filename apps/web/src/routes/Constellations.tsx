// Index page listing all of the user's constellations.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Card, CardHeading, EmptyState, ErrorState, ButtonGhost, ButtonInk, Field, InlineMessage, Shimmer } from "../components/ui";
import { Asterism, Flourish, IconArrowRight, IconPlus } from "../components/svg";
import { Modal } from "../components/Modal";
import { api, errorCopy } from "../lib/api";
import { relTime } from "../lib/format";

export default function Constellations() {
  const q = useQuery({ queryKey: ["constellations"], queryFn: () => api.constellations() });
  const [openCreate, setOpenCreate] = useState(false);
  const [openJoin, setOpenJoin] = useState(false);

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-5"
      >
        <div className="eyebrow">
          who you write with
        </div>
        <h1 className="display-title mt-2">
          your circles
        </h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          a constellation is two or more people writing under the same sky.
        </p>
      </motion.header>

      <Card className="mb-5">
        {q.isLoading && (
          <div className="space-y-3">
            <Shimmer className="h-12 w-full" />
            <Shimmer className="h-12 w-full" />
          </div>
        )}

        {q.isError && !q.isLoading && (
          <ErrorState
            asterism={<Asterism size={64} />}
            lines={[errorCopy(q.error)]}
            onRetry={() => q.refetch()}
          />
        )}

        {q.data && q.data.length === 0 && (
          <EmptyState
            asterism={<Asterism size={80} />}
            lines={["no circle yet.", "create one or use someone's invite."]}
          />
        )}

        {q.data && q.data.length > 0 && (
          <ul className="divide-y divide-[rgba(169,138,61,0.25)]">
            {q.data.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/app/constellation/${c.id}`}
                  className="flex items-center justify-between py-3.5 px-2 -mx-2 min-h-[56px] row-tap"
                >
                  <div>
                    <div className="font-serif text-[1.1rem] lowercase">{c.name}</div>
                    <div className="text-xs text-[var(--ink-faint)] tracking-wide mt-0.5">
                      {c.member_count} {c.member_count === 1 ? "member" : "members"} · {relTime(c.created_at)}
                    </div>
                  </div>
                  <IconArrowRight className="text-[var(--ink-faint)] row-arrow" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex justify-center"><Flourish /></div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <ButtonGhost onClick={() => setOpenCreate(true)}><IconPlus size={14} /> create</ButtonGhost>
        <ButtonGhost onClick={() => setOpenJoin(true)}>join with code</ButtonGhost>
      </div>

      {openCreate && <CreateModal onClose={() => setOpenCreate(false)} />}
      {openJoin && <JoinModal onClose={() => setOpenJoin(false)} />}
    </>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const c = await api.createConstellation(name.trim());
      await qc.invalidateQueries({ queryKey: ["constellations"] });
      nav(`/app/constellation/${c.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not create");
      setBusy(false);
    }
  }

  return (
    <Modal title="a new constellation" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}
        <Field label="name it" hint="something quiet. you can change it later.">
          <input autoFocus type="text" className="field"
            value={name} onChange={(e) => setName(e.target.value)} maxLength={48}
            placeholder="the inner circle, thursday letters..." />
        </Field>
        <div className="flex justify-end gap-3 mt-4">
          <ButtonGhost onClick={onClose}>cancel</ButtonGhost>
          <ButtonInk type="submit" disabled={busy || !name.trim()}>
            {busy ? "creating..." : "create"}
          </ButtonInk>
        </div>
      </form>
    </Modal>
  );
}

function JoinModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = parseToken(code);
    if (!t) { setErr("paste a join code or link."); return; }
    setBusy(true); setErr(null);
    try {
      const c = await api.joinConstellation(t);
      await qc.invalidateQueries({ queryKey: ["constellations"] });
      nav(`/app/constellation/${c.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not join");
      setBusy(false);
    }
  }
  return (
    <Modal title="join a constellation" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}
        <Field label="invite code or link" hint="someone sent you three quiet words.">
          <input autoFocus type="text" className="field"
            value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="moth-lantern-vellum" autoCapitalize="none" spellCheck={false} />
        </Field>
        <div className="flex justify-end gap-3 mt-4">
          <ButtonGhost onClick={onClose}>cancel</ButtonGhost>
          <ButtonInk type="submit" disabled={busy}>{busy ? "joining..." : "join"}</ButtonInk>
        </div>
      </form>
    </Modal>
  );
}

function parseToken(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/\/join\/([^/?#\s]+)/);
  if (m) return m[1];
  return t;
}
