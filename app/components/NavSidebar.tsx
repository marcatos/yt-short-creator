"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Pipeline",
    items: [
      { href: "/", label: "Home" },
      { href: "/library", label: "Library" },
      { href: "/candidates", label: "Candidates" },
      { href: "/jobs", label: "Jobs" },
    ],
  },
  {
    label: "Capture",
    items: [
      { href: "/replays", label: "Replays" },
      { href: "/inspiration", label: "Inspiration" },
    ],
  },
  {
    label: "Desk",
    items: [
      { href: "/setup", label: "Setup" },
      { href: "/settings", label: "Settings" },
      { href: "/connect", label: "Connect" },
    ],
  },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavSidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate?: () => void;
};

export function NavSidebar({
  collapsed,
  mobileOpen,
  onNavigate,
}: NavSidebarProps) {
  const pathname = usePathname() ?? "/";

  return (
    <aside
      aria-label="Primary"
      className={[
        "app-sidebar",
        collapsed ? "is-collapsed" : "",
        mobileOpen ? "is-mobile-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Link className="brand-lockup app-sidebar-brand" href="/" onClick={onNavigate}>
        <span className="brand-slash" aria-hidden="true" />
        <span className="app-sidebar-brand-text">
          <strong>S.MARCATO 42</strong>
          <small>SHORT CONTROL</small>
        </span>
      </Link>

      <nav className="app-sidebar-nav" aria-label="Primary navigation">
        {NAV_GROUPS.map((group) => (
          <div className="app-sidebar-group" key={group.label}>
            <p className="app-sidebar-group-label">{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={active ? "is-active" : undefined}
                      href={item.href}
                      onClick={onNavigate}
                      title={item.label}
                    >
                      <span className="app-sidebar-link-label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
