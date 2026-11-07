import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardHeading, ButtonGhost, ButtonInk, Avatar, Shimmer, SkySkeleton, EmptyState, ErrorState, InlineMessage } from "../components/ui";
import { Asterism, Flourish, IconBack, IconCopy, IconCheck, IconPlus } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import { initialsFor } from "../lib/format";
import { useAuth } from "../lib/auth";
import { EntryCard } from "./Journal";
import { JournalCompose } from "../components/JournalCompose";
import { CircleGraph } from "../components/CircleGraph";
import { SynastryPairCard } from "../components/SynastryPairCard";
import { ElizaThread } from "../components/ElizaThread";

export default function ConstellationDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [composing, setComposing] = useState(false);

  const constellation = useQuery({
    queryKey: ["constellation", id],
    queryFn: () => api.constellation(id),
  });
  const members = useQuery({
    queryKey: ["constellation", id, "members"],
    queryFn: () => api.constellationMembers(id),
  });
  const entries = useQuery({
    queryKey: ["journal", { constellation_id: id }],
    queryFn: () => api.journal({ constellation_id: id }),
  });
  // The scoped circle graph: shared traits + aspects + harmony per pair. Only
  // members ever get this (the API 404s otherwise, same as the page itself).
  const graph = useQuery({
    queryKey: ["constellation", id, "graph"],
    queryFn: () => api.circleGraph(id),
    enabled: !!constellation.data,
    staleTime: 5 * 60 * 1000,
  });

  // Build the invite link from the current origin so it works on whichever
  // domain the app is served from (constellate.me in prod, localhost in dev).
  const inviteUrl = constellation.data
    ? `${typeof window !== "undefined" ? window.location.origin : "https://constellate.me"}/join/${constellation.data.invite_token}`
    : "";

  return (
    <>
      <div className="mb-3">
        <Link to="/app/constellations" className="inline-flex items-center gap-2 eyebrow min-h-[44px]">
          <IconBack size={18} /> all circles
        </Link>
      </div>

      {constellation.isLoading && <Shimmer className="h-10 w-2/3 mb-4" />}

      {/* Not a member (or gone): the API returns 404, surfaced here as null. */}
      {!constellation.isLoading && (constellation.isError || constellation.data === null) && (
        <Card>
          <ErrorState
            asterism={<Asterism size={72} />}
            lines={constellation.isError ? [errorCopy(constellation.error)] : ["this circle isn't yours to read.", "ask for an invite."]}
            onRetry={constellation.isError ? () => constellation.refetch() : undefined}
          />
        </Card>
      )}

      {constellation.data && (
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-5"
        >
          <h1 className="display-title">
            {constellation.data.name}
          </h1>
          <p className="font-serif italic text-[var(--ink-soft)] mt-1">
            {constellation.data.member_count} {constellation.data.member_count === 1 ? "person" : "people"} writing here.
          </p>
        </motion.header>
      )}

      {/* Members + shared journal only render for confirmed members. */}
      {constellation.data && (
      <>
      {/* the constellation itself: stars, lines, harmony. tap everything. */}
      <Card className="mb-5">
        <CardHeading eyebrow="the constellation" title="your shared sky" />
        {(graph.isLoading || members.isLoading) && (
          <div className="space-y-3">
            <SkySkeleton className="h-64 w-full" />
            <Shimmer className="h-3 w-2/3 mx-auto" />
          </div>
        )}

        {graph.data && (
          <CircleGraph
            members={graph.data.members}
            edges={graph.data.edges}
            selfId={user?.id}
            size={340}
          />
        )}
        {graph.isError && !graph.isLoading && members.data && (
          <p className="font-serif italic text-[var(--ink-faint)] text-center py-2">
            the sky map is quiet right now. the pairs below still read.
          </p>
        )}

        {/* plain-language list of everyone you can read with */}
        {members.data && (() => {
          const others = members.data.filter((m) => m.id !== user?.id);
          const self = members.data.find((m) => m.id === user?.id) ?? null;
          if (others.length === 0) {
            return (
              <div className="mt-4 text-center font-serif italic text-[var(--ink-faint)]">
                <p>you are the only star here yet.</p>
                <p>invite someone below and a line will appear between you.</p>
              </div>
            );
          }
          return (
            <ul className="mt-5 grid gap-4">
              {others.map((m) => (
                <li key={m.id}>
                  <SynastryPairCard
                    otherId={m.id}
                    selfName={self?.display_name ?? user?.display_name}
                    otherName={m.display_name}
                    canRead={m.has_birth_data !== false}
                  />
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>

      {/* who is here + invite */}
      <Card className="mb-5">
        <CardHeading eyebrow="present" title="who is here" />
        {members.isLoading && <Shimmer className="h-10 w-full" />}
        {members.data && (
          <ul className="flex flex-wrap gap-x-4 gap-y-3">
            {members.data.map((m) => (
              <li key={m.id} className="flex flex-col items-center gap-1">
                <Avatar initials={initialsFor(m.display_name)} size={48} ring={m.role === "creator"} />
                <span className="font-serif italic text-[0.85rem] text-[var(--ink-soft)] lowercase">
                  {m.id === user?.id ? "you" : (m.display_name ?? "anon")}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* invite */}
        {constellation.data && (
          <>
            <div className="my-5 flex justify-center"><Flourish /></div>
            <div>
              <div className="eyebrow mb-1.5">
                invite a new member
              </div>
              <CopyRow value={inviteUrl} />
            </div>
          </>
        )}
      </Card>

      {/* eliza, a member of the circle */}
      <ElizaThread constellationId={id} />

      {/* shared journal */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif text-xl lowercase tracking-wide">shared journal</h2>
        <ButtonInk onClick={() => setComposing(true)} className="!py-2 !px-3 !min-h-[44px]">
          <IconPlus size={14} /> write
        </ButtonInk>
      </div>

      {entries.isLoading && (
        <Card><Shimmer className="h-16 w-full" /></Card>
      )}

      {entries.data && entries.data.length === 0 && (
        <Card>
          <EmptyState
            asterism={<Asterism size={64} />}
            lines={["no shared entries yet.", "be the first to write something here."]}
          />
        </Card>
      )}

      <ul className="space-y-4">
        {(entries.data ?? []).map((e) => (
          <EntryCard key={e.id} entry={e} showAuthor />
        ))}
      </ul>

      {composing && constellation.data && (
        <JournalCompose
          constellations={[constellation.data]}
          defaultConstellationId={constellation.data.id}
          onClose={() => setComposing(false)}
        />
      )}
      </>
      )}
    </>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }
  return (
    <div className="flex items-stretch gap-2">
      <div
        className="flex-1 font-mono text-[0.78rem] text-[var(--ink-soft)] py-2.5 px-3 truncate"
        style={{ background: "color-mix(in oklab, var(--parchment-shadow) 60%, transparent)", border: "1px solid rgba(169,138,61,0.3)", borderRadius: 2 }}
      >
        {value}
      </div>
      <button
        type="button"
        onClick={copy}
        className="btn-ghost !py-2 !px-3 !min-h-[44px] shrink-0"
        aria-label="copy invite link"
      >
        {copied ? <><IconCheck size={14} /> copied</> : <><IconCopy size={14} /> copy</>}
      </button>
    </div>
  );
}
