import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChartWheel } from "../components/ChartWheel";
import { ButtonGhost, ButtonInk, Card, CardHeading, ErrorState, Shimmer, SkySkeleton } from "../components/ui";
import { Asterism, Flourish, IconArrowRight, IconSynastry, IconPlus } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeOfDay } from "../lib/format";
import { JournalCompose } from "../components/JournalCompose";
import { SynastryPairCard } from "../components/SynastryPairCard";
import { CircleGraph } from "../components/CircleGraph";
import type { Constellation, ConstellationMember } from "../lib/types";

export default function Home() {
  const { user, setUser } = useAuth();
  const sky = useQuery({ queryKey: ["sky"], queryFn: () => api.skyToday() });
  const publicSky = useQuery({ queryKey: ["public-sky"], queryFn: () => api.publicSky(), staleTime: 15 * 60_000, retry: false });
  const constellations = useQuery({
    queryKey: ["constellations"],
    queryFn: () => api.constellations(),
  });
  const [composing, setComposing] = useState(false);

  // Pull members for each constellation so we can surface "you & X share a sky"
  // directly on home. Only constellations with >1 member are worth fetching.
  const cons = constellations.data ?? [];
  const memberQueries = useQueries({
    queries: cons
      .filter((c) => c.member_count > 1)
      .map((c) => ({
        queryKey: ["constellation", c.id, "members"],
        queryFn: () => api.constellationMembers(c.id),
      })),
  });

  // Flatten to a unique set of people you can read with (dedupe across circles).
  const comparable = useMemo(() => {
    const withMembers = cons.filter((c) => c.member_count > 1);
    const seen = new Set<string>();
    const out: { other: ConstellationMember; constellation: Constellation }[] = [];
    memberQueries.forEach((mq, i) => {
      const constellation = withMembers[i];
      if (!constellation || !mq.data) return;
      mq.data.forEach((m) => {
        if (m.id === user?.id) return;
        if (seen.has(m.id)) return;
        seen.add(m.id);
        out.push({ other: m, constellation });
      });
    });
    return out;
  }, [memberQueries, cons, user?.id]);

  // The circle that leads the page: the fullest one. Home opens on the shared
  // sky, not a menu; engine pages are depth behind it.
  const primaryCircle = useMemo(() => {
    const withMembers = cons.filter((c) => c.member_count > 1);
    if (withMembers.length === 0) return null;
    return [...withMembers].sort((a, b) => b.member_count - a.member_count)[0];
  }, [cons]);

  const graph = useQuery({
    queryKey: ["constellation", primaryCircle?.id, "graph"],
    queryFn: () => api.circleGraph(primaryCircle!.id),
    enabled: !!primaryCircle,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <>
      {/* the first viewport belongs to the sky. oversized editorial headline,
          then the constellation full-bleed beneath it. everything else is
          below the fold. */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6 pt-2"
      >
        <div className="eyebrow">
          {timeOfDay()} · {user?.display_name ?? "wanderer"}
        </div>
        <h1 className="display-hero mt-2">
          {primaryCircle ? (
            <>the sky over <em className="swash">{primaryCircle.name}</em></>
          ) : (
            <>your sky, <em className="swash">tonight</em></>
          )}
        </h1>
      </motion.header>

      {/* the constellation leads: full-bleed, stars, lines, harmony, one tap deep. */}
      {primaryCircle && (
        <section className="mb-10 ink-in ink-in-delay-1">
          <div className="bleed sm:mx-0">
            {graph.isLoading && <SkySkeleton className="h-[420px] w-full" />}
            {graph.data && (
              <CircleGraph
                members={graph.data.members}
                edges={graph.data.edges}
                selfId={user?.id}
                size={420}
                hero
              />
            )}
            {graph.isError && !graph.isLoading && (
              <p className="font-serif italic text-[var(--ink-faint)] text-center py-3">
                the sky map is quiet right now. your pairs below still read.
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-end px-1">
            <Link
              to={`/app/constellation/${primaryCircle.id}`}
              className="btn-link shrink-0 !min-h-[44px]"
            >
              open {primaryCircle.name} <IconArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      {/* one daily beat. graph first, then today in the house, then pairs. */}
      <section className="relative mb-2" aria-hidden="true">
        <span className="ghost-numeral absolute -top-3 right-0">i.</span>
      </section>
      <Card className="mb-8 ink-in ink-in-delay-2">
        <CardHeading eyebrow="today in the house" title="what's overhead" />
        {sky.isLoading && (
          <div className="space-y-3">
            <Shimmer className="h-40 w-40 rounded-full mx-auto" />
            <Shimmer className="h-3 w-3/4" />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        )}
        {sky.isError && !sky.isLoading && (
          <ErrorState
            asterism={<Asterism size={64} />}
            lines={[errorCopy(sky.error)]}
            onRetry={() => sky.refetch()}
          />
        )}
        {sky.data && (
          <div className="flex flex-col items-center">
            <ChartWheel chart={sky.data.chart} size={220} showHouses={false} ariaLabel="today's transit chart" />
            <div className="mt-5 space-y-2 w-full">
              {sky.data.lines.map((l, i) => (
                <p
                  key={i}
                  className="text-[0.96rem] leading-relaxed text-[var(--ink-soft)] flex gap-3"
                >
                  <span className="text-[var(--gold)] mt-1 shrink-0" aria-hidden="true">·</span>
                  <span className="font-serif italic">{l}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* the shared sky: public lane, identical for everyone. Silent if unavailable. */}
      {publicSky.data && (
        <Card className="mb-8">
          <CardHeading eyebrow="the sky for everyone" title={`a ${publicSky.data.moonPhase}`} />
          <p className="text-[0.8rem] tracking-wide text-[var(--ink-faint)]">
            {publicSky.data.positions.map((p) => `${p.body} ${p.degree}° ${p.sign}`).join(" · ")}
          </p>
          <p className="mt-3 font-serif italic text-[0.96rem] leading-relaxed text-[var(--ink-soft)] whitespace-pre-line">{publicSky.data.copy.text}</p>
          <p className="mt-3 text-[0.75rem] text-[var(--ink-faint)]">
            {publicSky.data.copy.source === "darkbloom" ? "written on the public lane (darkbloom)" : "fixed copy, no model"}. the same for everyone. your chart, readings and chats never take this route.
          </p>
        </Card>
      )}

      {/* today's prompt */}
      {sky.data && (
        <Card className="mb-8">
          <CardHeading eyebrow="today's prompt" title="a question for your notebook" />
          <p className="font-display text-[1.45rem] italic leading-snug text-[var(--ink)]" style={{ fontWeight: 360 }}>
            {sky.data.prompt}
          </p>
          <div className="mt-5 flex justify-end">
            <ButtonInk onClick={() => setComposing(true)}>
              <IconPlus size={16} /> write something
            </ButtonInk>
          </div>
        </Card>
      )}

      {/* pair harmony deltas, after the daily beat: the 10-second home scan.
          each pair is a tarot-grade object now, not a list row. */}
      {comparable.length > 0 && (
        <section className="mb-8 ink-in ink-in-delay-3 relative">
          <span className="ghost-numeral absolute -top-6 right-0" aria-hidden="true">ii.</span>
          <div className="eyebrow mb-2">the sky between you</div>
          <h2 className="display-heading mb-1">pair harmony</h2>
          <p className="font-serif italic text-[var(--ink-soft)] mb-4">
            {comparable.length === 1
              ? `you and ${comparable[0].other.display_name ?? "someone"} share a sky. read it.`
              : "you share a sky with these people. read what's between you."}
          </p>
          <div className="grid grid-cols-1 gap-4">
            {comparable.slice(0, 4).map(({ other, constellation }) => (
              <SynastryPairCard
                key={other.id}
                otherId={other.id}
                selfName={user?.display_name}
                otherName={other.display_name}
                canRead={other.has_birth_data !== false}
                context={constellation.name}
              />
            ))}
          </div>
          {comparable.length > 4 && (
            <div className="mt-4 text-center">
              <Link to="/app/constellations" className="btn-link">
                <IconSynastry size={16} /> and {comparable.length - 4} more
              </Link>
            </div>
          )}
        </section>
      )}

      {/* constellations */}
      <Card>
        <CardHeading eyebrow="your circles" title="constellations" />

        {constellations.isLoading && (
          <div className="space-y-3">
            <Shimmer className="h-12 w-full" />
            <Shimmer className="h-12 w-full" />
          </div>
        )}

        {constellations.isError && !constellations.isLoading && (
          <ErrorState
            asterism={<Asterism size={56} />}
            lines={[errorCopy(constellations.error)]}
            onRetry={() => constellations.refetch()}
          />
        )}

        {constellations.data && constellations.data.length === 0 && (
          <div className="flex flex-col items-center text-center py-8">
            <Asterism size={72} />
            <div className="mt-5 space-y-1 font-serif italic text-[var(--ink-soft)]">
              <p>no circle yet.</p>
              <p className="text-[var(--ink-faint)]">a circle is your group: two or more people writing under the same sky, reading what's between them.</p>
              <p className="text-[var(--ink-faint)]">make one, or join with a friend's invite code.</p>
            </div>
          </div>
        )}

        {constellations.data && constellations.data.length > 0 && (
          <ul className="divide-y divide-[rgba(169,138,61,0.25)]">
            {constellations.data.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/app/constellation/${c.id}`}
                  className="flex items-center justify-between py-3.5 px-2 -mx-2 min-h-[56px] row-tap"
                >
                  <div>
                    <div className="font-serif text-[1.1rem] lowercase">{c.name}</div>
                    <div className="text-xs text-[var(--ink-faint)] tracking-wide mt-0.5">
                      {c.member_count} {c.member_count === 1 ? "member" : "members"}
                    </div>
                  </div>
                  <IconArrowRight className="text-[var(--ink-faint)] row-arrow" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-center">
          <Flourish />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <CreateButton />
          <JoinButton />
        </div>
      </Card>

      {/* depth, quietly: the record surfaces live behind one soft row, not a
          menu of engine names at the front door. */}
      <nav aria-label="go deeper" className="mt-5 mb-5">
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          <Link to="/app/chart" className="tab-pill">your record</Link>
          <Link to="/app/convergence" className="tab-pill">where they meet</Link>
          <Link to="/app/atlas" className="tab-pill">atlas</Link>
        </div>
      </nav>

      <PrivateReadingNote user={user} onSaved={setUser} />

      {composing && (
        <JournalCompose
          constellations={constellations.data ?? []}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}

function PrivateReadingNote({ user, onSaved }: { user: import("../lib/types").User | null; onSaved: (u: import("../lib/types").User | null) => void }) {
  const [open, setOpen] = useState(false);
  const [orientation, setOrientation] = useState(user?.sexual_orientation ?? "");
  const [preference, setPreference] = useState(user?.relational_preference ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      const next = await api.updatePrivateProfile({
        sexual_orientation: orientation.trim() || null,
        relational_preference: preference.trim() || null,
      });
      onSaved(next);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 !p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left min-h-[44px] flex items-center justify-between gap-4"
        aria-expanded={open}
      >
        <div>
          <div className="eyebrow">private to you</div>
          <div className="font-serif text-[1.08rem] lowercase mt-0.5">a note for how readings see you</div>
        </div>
        <span className="font-serif text-xl text-[var(--gold-deep)]" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <form onSubmit={save} className="pt-3 mt-2 border-t border-[rgba(169,138,61,0.22)]">
          <p className="font-serif italic text-[0.88rem] leading-relaxed text-[var(--ink-soft)] mb-4">
            optional. these words stay private, never shown to your circle or eliza. they only stop a pair reading from using a romantic lens you did not welcome.
          </p>
          <Field label="sexual orientation" hint="your words, or leave it blank">
            <input
              className="field"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value)}
              maxLength={120}
              placeholder="queer, straight, bi, ace..."
            />
          </Field>
          <Field label="relational preference" hint="free-form, e.g. platonic only or romantic framing welcome">
            <input
              className="field"
              value={preference}
              onChange={(e) => setPreference(e.target.value)}
              maxLength={240}
              placeholder="how should a reading hold your relationships?"
            />
          </Field>
          <div className="flex items-center justify-end gap-3 mt-3">
            {saved && <span className="font-serif italic text-sm text-[var(--ink-faint)]">kept private.</span>}
            <ButtonInk type="submit" disabled={busy}>{busy ? "saving..." : "save note"}</ButtonInk>
          </div>
        </form>
      )}
    </Card>
  );
}

function CreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonGhost onClick={() => setOpen(true)}><IconPlus size={14} /> create</ButtonGhost>
      {open && <CreateConstellationModal onClose={() => setOpen(false)} />}
    </>
  );
}

function JoinButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonGhost onClick={() => setOpen(true)}>join with code</ButtonGhost>
      {open && <JoinConstellationModal onClose={() => setOpen(false)} />}
    </>
  );
}

// Inline modals defined here to keep file tidy (small components, single-use).
import { Modal } from "../components/Modal";
import { Field, InlineMessage } from "../components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

function CreateConstellationModal({ onClose }: { onClose: () => void }) {
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
          <input
            autoFocus
            type="text"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="the inner circle, thursday letters..."
            maxLength={48}
          />
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

function JoinConstellationModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = parseToken(code);
    if (!token) { setErr("paste a join code or link."); return; }
    setBusy(true); setErr(null);
    try {
      const c = await api.joinConstellation(token);
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
        <Field label="invite code or link" hint="someone sent you three quiet words, or a link.">
          <input
            autoFocus
            type="text"
            className="field"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="moth-lantern-vellum"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <div className="flex justify-end gap-3 mt-4">
          <ButtonGhost onClick={onClose}>cancel</ButtonGhost>
          <ButtonInk type="submit" disabled={busy}>
            {busy ? "joining..." : "join"}
          </ButtonInk>
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
