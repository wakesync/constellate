import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardHeading, EmptyState, ErrorState, ButtonInk, Pill, Shimmer } from "../components/ui";
import { Asterism, IconLock, IconShare, IconPlus } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import { relTime } from "../lib/format";
import { JournalCompose } from "../components/JournalCompose";
import type { JournalEntry } from "../lib/types";

type Filter = "all" | "private" | "shared";

export default function Journal() {
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);

  const entries = useQuery({ queryKey: ["journal"], queryFn: () => api.journal() });
  const constellations = useQuery({
    queryKey: ["constellations"],
    queryFn: () => api.constellations(),
  });

  const all = entries.data ?? [];
  const filtered = all.filter((e) => {
    if (filter === "private") return e.constellation_id === null;
    if (filter === "shared") return e.constellation_id !== null;
    return true;
  });

  // Show only entries the user wrote (not shared with them by others).
  // Server already filters; if not, this still works.
  const mine = filtered;

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-5"
      >
        <div className="eyebrow">
          your notebook
        </div>
        <h1 className="display-title mt-2">
          journal
        </h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          the smallest true thing, written down.
        </p>
      </motion.header>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Pill active={filter === "all"} onClick={() => setFilter("all")}>all</Pill>
          <Pill active={filter === "private"} onClick={() => setFilter("private")}>private</Pill>
          <Pill active={filter === "shared"} onClick={() => setFilter("shared")}>shared</Pill>
        </div>
        <ButtonInk onClick={() => setComposing(true)} className="!py-2 !px-3 !min-h-[44px]">
          <IconPlus size={14} /> write
        </ButtonInk>
      </div>

      {entries.isLoading && (
        <Card>
          <div className="space-y-3">
            <Shimmer className="h-3 w-1/3" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-3/4" />
          </div>
        </Card>
      )}

      {entries.isError && !entries.isLoading && (
        <Card>
          <ErrorState
            asterism={<Asterism size={64} />}
            lines={[errorCopy(entries.error)]}
            onRetry={() => entries.refetch()}
          />
        </Card>
      )}

      {entries.data && mine.length === 0 && (
        <Card>
          <EmptyState
            asterism={<Asterism size={72} />}
            lines={["no entries yet.", "the page is waiting."]}
          />
          <div className="flex justify-center mt-2">
            <ButtonInk onClick={() => setComposing(true)}>
              <IconPlus size={14} /> begin
            </ButtonInk>
          </div>
        </Card>
      )}

      <ul className="space-y-4">
        {mine.map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </ul>

      {composing && (
        <JournalCompose
          constellations={constellations.data ?? []}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}

export function EntryCard({ entry, showAuthor }: { entry: JournalEntry; showAuthor?: boolean }) {
  const isPrivate = entry.constellation_id === null;
  return (
    <li>
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs text-[var(--ink-faint)] tracking-wide">
            {showAuthor && entry.user_name && (
              <span className="font-serif italic text-[var(--ink-soft)] lowercase">
                {entry.user_name}
              </span>
            )}
            {showAuthor && entry.user_name && <span aria-hidden>·</span>}
            <span>{relTime(entry.written_at)}</span>
          </div>
          <span
            className="inline-flex items-center gap-1 eyebrow"
            style={{ color: isPrivate ? "var(--ink-faint)" : "var(--oxblood)" }}
          >
            {isPrivate ? <><IconLock /> private</> : <><IconShare /> {entry.constellation_name ?? "shared"}</>}
          </span>
        </div>
        <p className="font-serif text-[1.05rem] leading-relaxed whitespace-pre-wrap">
          {entry.body}
        </p>
        {entry.transit_snapshot?.line && (
          <p className="mt-3 pt-2 text-xs font-serif italic text-[var(--ink-faint)] border-t border-[rgba(169,138,61,0.18)]">
            {entry.transit_snapshot.line}
          </p>
        )}
      </Card>
    </li>
  );
}
