// Eliza in the circle: a thread INSIDE a constellation. She speaks as a member,
// not a chatbot bubble. Her lines sit in the parchment, marked by a small
// asterism and her name in italic, distinct from what the humans type but not a
// product chat UI. Shimmer while she is thinking; fade+rise as lines arrive.

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading, Shimmer } from "./ui";
import { Asterism, IconArrowRight } from "./svg";
import { api, errorCopy } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ElizaMessage } from "../lib/types";

export function ElizaThread({ constellationId }: { constellationId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const thread = useQuery({
    queryKey: ["eliza", constellationId],
    queryFn: () => api.elizaMessages(constellationId),
  });

  const send = useMutation({
    mutationFn: (body: string) => api.elizaSend(constellationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eliza", constellationId] });
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.data, send.isPending]);

  function submit() {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft("");
    send.mutate(body);
  }

  return (
    <Card className="mb-5">
      <CardHeading eyebrow="in the circle" title="ask eliza" />

      <div
        ref={scrollRef}
        className="max-h-[52vh] overflow-y-auto pr-1 space-y-4"
        style={{ scrollbarWidth: "thin" }}
      >
        {thread.isLoading && <Shimmer className="h-16 w-full" />}

        {thread.isError && (
          <p className="font-serif italic text-[var(--ink-faint)]">{errorCopy(thread.error)}</p>
        )}

        <AnimatePresence initial={false}>
          {(thread.data ?? []).map((m) => (
            <Line key={m.id} message={m} isSelf={m.user_id === user?.id} />
          ))}
        </AnimatePresence>

        {send.isPending && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2"
          >
            <span className="mt-1 opacity-70"><Asterism size={16} /></span>
            <div className="flex-1">
              <div className="eyebrow mb-1">eliza</div>
              <Shimmer className="h-4 w-2/3" />
            </div>
          </motion.div>
        )}

        {send.isError && (
          <p className="font-serif italic text-[var(--ink-faint)]">{errorCopy(send.error)}</p>
        )}
      </div>

      {/* compose */}
      <div className="mt-4 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="why do we keep having the same fight..."
          className="flex-1 resize-none font-serif text-[0.95rem] leading-relaxed py-2.5 px-3 bg-transparent outline-none"
          style={{ border: "1px solid rgba(169,138,61,0.3)", borderRadius: 2, minHeight: 44 }}
          aria-label="ask eliza"
        />
        <button
          type="button"
          onClick={submit}
          disabled={send.isPending || !draft.trim()}
          className="btn-ink !py-2 !px-3 !min-h-[44px] shrink-0 disabled:opacity-40"
          aria-label="send to eliza"
        >
          <IconArrowRight size={16} />
        </button>
      </div>
    </Card>
  );
}

function Line({ message, isSelf }: { message: ElizaMessage; isSelf: boolean }) {
  const isEliza = message.role === "eliza";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="flex items-start gap-2"
    >
      {isEliza ? (
        <span className="mt-1 opacity-70"><Asterism size={16} /></span>
      ) : (
        <span className="mt-1 w-4 shrink-0" />
      )}
      <div className="flex-1">
        <div className="eyebrow mb-1">
          {isEliza ? "eliza" : isSelf ? "you" : "a member"}
        </div>
        <p
          className={
            isEliza
              ? "font-serif text-[0.98rem] leading-relaxed text-[var(--ink)] italic"
              : "font-serif text-[0.95rem] leading-relaxed text-[var(--ink-soft)]"
          }
        >
          {message.body}
        </p>
      </div>
    </motion.div>
  );
}
