import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { platformAuthenticatorIsAvailable, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { HeroShell } from "../components/AppShell";
import { ButtonInk, ButtonLink, Card, Field, InlineMessage } from "../components/ui";
import { Asterism, IconKey, Flourish } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Signin() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { refresh, isAuthed } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [supported, setSupported] = useState<boolean | null>(null);

  // Redirect away if already authed (side effect, not during render).
  useEffect(() => {
    if (isAuthed) nav(from || "/app/home", { replace: true });
  }, [isAuthed, from, nav]);

  // Detect passkey support so we can show a clear unsupported state.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!browserSupportsWebAuthn()) {
          if (alive) setSupported(false);
          return;
        }
        // Platform authenticator (face/finger) is preferred but not required;
        // a roaming key still works, so treat WebAuthn support as the gate.
        await platformAuthenticatorIsAvailable().catch(() => false);
        if (alive) setSupported(true);
      } catch {
        if (alive) setSupported(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function onSignin() {
    setBusy(true); setErr(null);
    try {
      await api.passkeyLogin(email.trim() || undefined);
      await refresh();
      nav(from || "/app/home", { replace: true });
    } catch (e) {
      setErr(authErrorCopy(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setErr("an email, please."); return; }
    setBusy(true); setErr(null);
    try {
      await api.passkeyRegister(email.trim());
      await refresh();
      nav("/app/onboarding", { replace: true });
    } catch (e) {
      setErr(authErrorCopy(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <HeroShell>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
        className="flex-1 flex flex-col items-center justify-center"
      >
        <div className="text-center mb-6">
          <Asterism size={92} />
          <h1 className="display-hero mt-4">
            {mode === "signin" ? "welcome back" : "a quiet beginning"}
          </h1>
          <p className="font-serif italic text-[var(--ink-soft)] mt-2 text-[1.02rem]">
            {mode === "signin"
              ? "your face, your finger, your key. no password to remember."
              : "we'll set up a passkey on this device. nothing for you to type later."}
          </p>
        </div>

        <Card className="w-full max-w-md">
          {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}
          {supported === false && (
            <InlineMessage variant="err" className="mb-4">
              this device does not support passkeys. open constellate in a browser that does, or on your phone.
            </InlineMessage>
          )}

          {mode === "signup" && (
            <form onSubmit={onSignup}>
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
              <ButtonInk type="submit" disabled={busy || supported === false} className="w-full">
                <IconKey /> create a passkey
              </ButtonInk>
            </form>
          )}

          {mode === "signin" && (
            <ButtonInk onClick={onSignin} disabled={busy || supported === false} className="w-full">
              <IconKey /> use a passkey to sign in
            </ButtonInk>
          )}

          <div className="mt-5 flex justify-center">
            <Flourish />
          </div>

          <div className="mt-3 text-center">
            {mode === "signin" ? (
              <ButtonLink onClick={() => { setErr(null); setMode("signup"); }}>
                first time? create a passkey →
              </ButtonLink>
            ) : (
              <ButtonLink onClick={() => { setErr(null); setMode("signin"); }}>
                ← already have one? sign in
              </ButtonLink>
            )}
          </div>
        </Card>

        <p className="mt-8 text-center text-xs text-[var(--ink-faint)] font-serif italic max-w-xs">
          no passwords, no tracking, no analytics. just you and the sky on the day you arrived.
        </p>
      </motion.div>
    </HeroShell>
  );
}

// Friendly copy for passkey ceremony errors. WebAuthn throws DOMExceptions with
// specific names when the user cancels, the credential is missing, etc.
function authErrorCopy(e: unknown): string {
  if (e instanceof Error) {
    const name = e.name;
    if (name === "NotAllowedError") return "that was cancelled, or it timed out. try again when you're ready.";
    if (name === "InvalidStateError") return "this device is already registered. try signing in instead.";
    if (name === "AbortError") return "that was cancelled. try again when you're ready.";
    if (name === "SecurityError") return "this page could not start a passkey. check the address and try again.";
  }
  return errorCopy(e);
}
