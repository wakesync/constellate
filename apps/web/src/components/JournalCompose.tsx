// Bottom-sheet compose. Subtle. Inline messages only.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { ButtonGhost, ButtonInk, Field, InlineMessage } from "./ui";
import { IconLock, IconShare } from "./svg";
import { api } from "../lib/api";
import type { Constellation } from "../lib/types";

export function JournalCompose({
  constellations,
  onClose,
  defaultConstellationId,
}: {
  constellations: Constellation[];
  onClose: () => void;
  defaultConstellationId?: string;
}) {
  const [body, setBody] = useState("");
  const [shareWith, setShareWith] = useState<string>(defaultConstellationId ?? "private");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true); setErr(null);
    try {
      const cid = shareWith === "private" ? null : shareWith;
      await api.createJournalEntry(trimmed, cid);
      await qc.invalidateQueries({ queryKey: ["journal"] });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not save");
      setBusy(false);
    }
  }

  return (
    <Modal title="a quiet entry" onClose={onClose}>
      <form onSubmit={submit}>
        {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}

        <textarea
          autoFocus
          className="field"
          rows={6}
          placeholder="what's the smallest true thing you can write?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ borderBottom: "none", lineHeight: 1.7 }}
          maxLength={4000}
        />
        <div className="rule-gold mb-4" />

        <Field label="share with">
          <div className="flex flex-col gap-1">
            <ShareOpt
              value="private"
              current={shareWith}
              onChange={setShareWith}
              icon={<IconLock />}
              title="private"
              subtitle="only you. always."
            />
            {constellations.map((c) => (
              <ShareOpt
                key={c.id}
                value={c.id}
                current={shareWith}
                onChange={setShareWith}
                icon={<IconShare />}
                title={c.name}
                subtitle={`${c.member_count} ${c.member_count === 1 ? "member" : "members"}`}
              />
            ))}
          </div>
        </Field>

        <p className="text-xs font-serif italic text-[var(--ink-faint)] mt-1 mb-4">
          the sky right now · {new Date().toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })} · {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}
        </p>

        <div className="flex justify-end gap-3">
          <ButtonGhost onClick={onClose}>cancel</ButtonGhost>
          <ButtonInk type="submit" disabled={busy || !body.trim()}>
            {busy ? "saving..." : "save"}
          </ButtonInk>
        </div>
      </form>
    </Modal>
  );
}

function ShareOpt({
  value, current, onChange, icon, title, subtitle,
}: {
  value: string;
  current: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-sm text-left min-h-[44px]"
      style={{
        borderLeft: `2px solid ${active ? "var(--oxblood)" : "transparent"}`,
        background: active ? "color-mix(in oklab, var(--gold-soft) 10%, transparent)" : "transparent",
      }}
    >
      <span style={{ color: active ? "var(--oxblood)" : "var(--ink-faint)" }}>{icon}</span>
      <span>
        <span className="block font-serif text-[1.02rem] lowercase">{title}</span>
        <span className="block text-xs text-[var(--ink-faint)]">{subtitle}</span>
      </span>
    </button>
  );
}
