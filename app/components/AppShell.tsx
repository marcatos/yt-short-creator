"use client";

import { useEffect, useState, type ReactNode } from "react";

import { LayoutDensityToggle } from "@/app/components/LayoutDensityToggle";
import { NavSidebar } from "@/app/components/NavSidebar";

const SIDEBAR_COLLAPSED_KEY = "ui.sidebarCollapsed";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    setCollapsed(stored === "1");
  }, []);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 900) {
        setMobileOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div
      className={[
        "app-shell",
        collapsed ? "is-sidebar-collapsed" : "",
        mobileOpen ? "is-mobile-nav-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <NavSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen ? (
        <button
          aria-label="Close navigation"
          className="app-shell-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <div className="app-shell-main">
        <header className="app-toolbar">
          <div className="app-toolbar-start">
            <button
              aria-expanded={mobileOpen}
              aria-label="Open navigation"
              className="app-toolbar-menu"
              onClick={() => setMobileOpen(true)}
              type="button"
            >
              Menu
            </button>
            <button
              aria-pressed={collapsed}
              className="app-toolbar-collapse"
              onClick={toggleCollapsed}
              type="button"
            >
              {collapsed ? "Espandi" : "Comprimi"}
            </button>
          </div>
          <LayoutDensityToggle />
        </header>
        <div className="app-shell-content">{children}</div>
      </div>
    </div>
  );
}
