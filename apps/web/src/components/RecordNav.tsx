// RecordNav: a small segmented sub-nav shared by the four "your record"
// surfaces (chart, design, keys, enneagram). The AppShell bottom bar stays at
// five tabs; the "chart" tab is the doorway into this family, and this strip
// lets you move sideways between the self-knowledge readings without eating a
// bottom-tab slot. Horizontally scrollable so it never crowds a phone.

import { NavLink } from "react-router-dom";

const ITEMS: { to: string; label: string }[] = [
  { to: "/app/chart", label: "chart" },
  { to: "/app/design", label: "design" },
  { to: "/app/keys", label: "keys" },
  { to: "/app/enneagram", label: "type" },
  { to: "/app/socionics", label: "socionics" },
  { to: "/app/convergence", label: "convergence" },
];

export function RecordNav() {
  return (
    <nav
      aria-label="your record"
      className="mb-5 -mx-1 overflow-x-auto no-scrollbar"
    >
      <div className="flex items-center gap-1.5 px-1 min-w-max">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `tab-pill whitespace-nowrap ${isActive ? "active" : ""}`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
