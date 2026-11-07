// AppShell: top bar + bottom tabbar for authed routes.
// Mobile-first; on desktop becomes a centered column.

import { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Wordmark, IconHome, IconChart, IconAtlas, IconQuillNav, IconGroup } from "./svg";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { motion } from "framer-motion";

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { refresh } = useAuth();

  async function onLogout() {
    await api.logout();
    await refresh();
    nav("/app/signin", { replace: true });
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="app-nav safe-top">
        <div className="mx-auto max-w-[760px] px-5 py-3 flex items-center justify-between">
          <Link to="/app/home" className="inline-flex items-center" aria-label="constellate">
            <Wordmark size="text-xl" />
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="eyebrow hover:text-[var(--oxblood)] py-2 px-2 min-h-[44px]"
          >
            sign out
          </button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
        className="flex-1 mx-auto w-full max-w-[760px] px-5 sm:px-8 pt-7 pb-32"
      >
        {children}
      </motion.main>

      <nav className="fixed bottom-0 inset-x-0 z-40 safe-bot pointer-events-none">
        <div className="mx-auto max-w-[680px] px-4">
          <div className="nav-dock px-2 py-1 flex items-center justify-around pointer-events-auto">
            <TabIcon to="/app/home" label="home" icon={<IconHome />} />
            <TabIcon to="/app/chart" label="chart" icon={<IconChart />} />
            <TabIcon to="/app/atlas" label="atlas" icon={<IconAtlas />} />
            <TabIcon to="/app/journal" label="journal" icon={<IconQuillNav />} />
            <TabIcon to="/app/constellations" label="circles" icon={<IconGroup />} />
          </div>
        </div>
      </nav>
    </div>
  );
}

function TabIcon({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-h-[48px] min-w-[56px] rounded-full transition-colors duration-300 ${
          isActive
            ? "text-[var(--oxblood)]"
            : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]"
        }`
      }
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-[0.62rem] tracking-[0.14em] uppercase">{label}</span>
    </NavLink>
  );
}

// Centered hero shell for unauth (signin / onboarding / join)
export function HeroShell({ children, back }: { children: ReactNode; back?: string }) {
  return (
    <div className="min-h-[100dvh] flex flex-col safe-top safe-bot">
      <header className="mx-auto w-full max-w-screen-sm px-5 py-4 flex items-center justify-between">
        {back ? (
          <Link
            to={back}
            className="eyebrow hover:text-[var(--oxblood)] min-h-[44px] inline-flex items-center"
          >
            ← back
          </Link>
        ) : <span />}
        <Wordmark size="text-xl" />
        <span className="w-12" />
      </header>
      <main className="flex-1 mx-auto w-full max-w-screen-sm px-5 pb-8 flex flex-col">
        {children}
      </main>
    </div>
  );
}
