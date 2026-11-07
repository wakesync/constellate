// /join/:token. entry point from invite links.

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { HeroShell } from "../components/AppShell";
import { ButtonInk, ButtonLink, ButtonGhost, Card, InlineMessage, Field } from "../components/ui";
import { Asterism, Flourish, IconKey } from "../components/svg";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Join() {
  const { token = "" } = useParams();
  const { isAuthed, refresh, loading } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");

  async function accept() {
    setBusy(true); setErr(null);
    try {
      const c = await api.joinConstellation(token);
      await qc.invalidateQueries({ queryKey: ["constellations"] });
      nav(`/app/constellation/${c.id}`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not join");
      setBusy(false);
    }
  }

  async function loginAndAccept() {
    setBusy(true); setErr(null);
    try {
      await api.passkeyLogin();
      await refresh();
      await accept();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not sign in");
      setBusy(false);
    }
  }

  async function registerAndAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setErr("an email, please."); return; }
    setBusy(true); setErr(null);
    try {
      await api.passkeyRegister(email.trim());
      await refresh();
      // After register, need to do onboarding before chart/synastry works,
      // but acceptance can happen first.
      const c = await api.joinConstellation(token);
      await qc.invalidateQueries({ queryKey: ["constellations"] });
      nav("/app/onboarding", { replace: true, state: { redirectTo: `/app/constellation/${c.id}` } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not create the passkey");
      setBusy(false);
    }
  }

  return (
    <HeroShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex-1 flex flex-col items-center justify-center"
      >
        <div className="text-center mb-6">
          <Asterism size={92} />
          <h1 className="display-hero mt-4">
            you've been invited
          </h1>
          <p className="font-serif italic text-[var(--ink-soft)] mt-2 max-w-sm">
            someone you know wants to write under the same sky as you. accept the invite to join their constellation.
          </p>
        </div>

        <Card className="w-full max-w-md">
          {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}

          <div className="eyebrow mb-2">
            invite token
          </div>
          <div className="font-mono text-[0.95rem] text-[var(--oxblood)] mb-5 break-all">
            {token}
          </div>

          {loading ? (
            <div className="ink-shimmer h-12 w-full" />
          ) : isAuthed ? (
            <ButtonInk onClick={accept} disabled={busy} className="w-full">
              {busy ? "joining..." : "accept invite"}
            </ButtonInk>
          ) : mode === "signin" ? (
            <>
              <ButtonInk onClick={loginAndAccept} disabled={busy} className="w-full">
                <IconKey /> sign in & accept
              </ButtonInk>
              <div className="mt-5 flex justify-center"><Flourish /></div>
              <div className="mt-3 text-center">
                <ButtonLink onClick={() => { setErr(null); setMode("signup"); }}>
                  first time? create a passkey →
                </ButtonLink>
              </div>
            </>
          ) : (
            <form onSubmit={registerAndAccept}>
              <Field label="email">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="field"
                  placeholder="you@somewhere.world"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <ButtonInk type="submit" disabled={busy} className="w-full">
                <IconKey /> create a passkey & accept
              </ButtonInk>
              <div className="mt-3 text-center">
                <ButtonLink onClick={() => { setErr(null); setMode("signin"); }}>
                  ← already have one? sign in
                </ButtonLink>
              </div>
            </form>
          )}
        </Card>

        {!isAuthed && !loading && (
          <p className="mt-6 text-center text-xs text-[var(--ink-faint)] font-serif italic max-w-xs">
            no password to remember. just your device.
          </p>
        )}
        <div className="mt-6">
          <ButtonGhost onClick={() => nav("/")} className="!min-h-[40px] !py-2 !px-3 text-xs">
            decline
          </ButtonGhost>
        </div>
      </motion.div>
    </HeroShell>
  );
}
