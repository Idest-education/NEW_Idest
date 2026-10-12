"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { band, bandTone, groupByDate, type Tone } from "../lib/format";
import { setTheme, useTheme } from "../lib/theme";
import { useApi, useLoad } from "../lib/use-api";
import { Icon } from "./icon";
import Image from "next/image";
import welcomeIo from "../public/illustrations/welcome-io.webp";
import { Logo } from "./logo";
import { Menu } from "./menu";
import { isTeacher, useAccount } from "./session";
import styles from "./shell.module.css";

const DESKTOP = "(min-width: 900px)";

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const openNav = () => {
    if (window.matchMedia(DESKTOP).matches) setCollapsed(false);
    else {
      setDrawerOpen(true);
      drawer.current?.showModal();
    }
  };

  return (
    <div className={styles.shell} data-collapsed={collapsed || undefined}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <aside className={styles.sidebar} aria-label="Sidebar">
        <Sidebar onHide={() => setCollapsed(true)} hideLabel="Collapse sidebar" />
      </aside>
      <dialog
        ref={drawer}
        className={styles.drawer}
        aria-label="Menu"
        onClick={(e) => e.target === drawer.current && drawer.current?.close()}
        onClose={() => setDrawerOpen(false)}
      >
        {/* Rendered only while open, so the sidebar's data is not fetched twice. */}
        {drawerOpen && <Sidebar onHide={() => drawer.current?.close()} hideLabel="Close menu" />}
      </dialog>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className="btn btn-ghost btn-icon" aria-label="Open menu" onClick={openNav}>
            <Icon name="menu" />
          </button>
          <Link href="/" className={styles.topLogo} aria-label="AIO home">
            <Logo />
          </Link>
          <Link href="/" className="btn btn-ghost btn-icon" aria-label="New grading">
            <Icon name="edit_square" />
          </Link>
        </header>
        <main id="main" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ onHide, hideLabel }: { onHide: () => void; hideLabel: string }) {
  const pathname = usePathname();
  const { signedIn, profile } = useAccount();
  const teacher = isTeacher(profile);
  const current = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <div className={styles.side}>
      <div className={styles.sideHead}>
        <Link href="/" aria-label="AIO home">
          <Logo />
        </Link>
        <button className="btn btn-ghost btn-icon" aria-label={hideLabel} onClick={onHide}>
          <Icon name="left_panel_close" />
        </button>
      </div>

      <nav className={styles.nav} aria-label="Main">
        <Link href="/" className={styles.navItem} aria-current={current("/")}>
          <Icon name="edit_square" /> New grading
        </Link>
        {teacher && (
          <>
            <Link href="/batches/new" className={styles.navItem} aria-current={current("/batches/new")}>
              <Icon name="upload_file" /> New batch
            </Link>
            <Link href="/batches" className={styles.navItem} aria-current={current("/batches")}>
              <Icon name="stacks" /> Batches
            </Link>
            <Link href="/history" className={styles.navItem} aria-current={current("/history")}>
              <Icon name="history" /> History
            </Link>
          </>
        )}
      </nav>

      <div className={styles.recents}>{teacher ? <Recents /> : !signedIn && <SignInCard />}</div>

      <div className={styles.sideFoot}>{signedIn ? <AccountMenu /> : <ThemeMenu />}</div>
    </div>
  );
}

interface Recent {
  key: string;
  href: string;
  title: string;
  date: string;
  icon: string;
  meta: string;
  tone?: Tone;
}

function Recents() {
  const api = useApi();
  const pathname = usePathname();
  const { recentsVersion } = useAccount();
  const { data, error } = useLoad(`recents:${recentsVersion}`, async (): Promise<Recent[]> => {
    const [mine, batches] = await Promise.all([api.mine(1, 20), api.batches()]);
    return [
      ...mine.data.map((g) => ({
        key: `g${g.id}`,
        href: `/r/${g.id}`,
        title: g.taskPrompt,
        date: g.submittedAt,
        icon: "description",
        meta: g.aiScores ? band(g.aiScores.overall) : "",
        tone: g.aiScores ? bandTone(g.aiScores.overall) : undefined,
      })),
      ...batches.map((b) => ({
        key: `b${b.id}`,
        href: `/batches/${b.id}`,
        title: b.name,
        date: b.createdAt,
        icon: "stacks",
        meta: "",
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));
  });

  if (error && !data) return <p className={styles.recentsNote}>Couldn't load recent work.</p>;
  if (!data) return <div className="skeleton" style={{ height: 96, margin: "0 8px" }} />;
  if (data.length === 0) return <p className={styles.recentsNote}>Your gradings and batches will show up here.</p>;

  return (
    <>
      {groupByDate(data, (r) => r.date).map((group) => (
        <section key={group.label} className={styles.group} aria-label={group.label}>
          <h2 className={styles.groupLabel}>{group.label}</h2>
          <ul>
            {group.items.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className={styles.recent} aria-current={pathname === r.href ? "page" : undefined}>
                  <Icon name={r.icon} />
                  <span className={styles.recentTitle}>{r.title}</span>
                  {r.meta && <span className={`${styles.recentMeta} num ${r.tone ? `tone-${r.tone}` : ""}`}>{r.meta}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function SignInCard() {
  return (
    <div className={styles.signIn}>
      <Image src={welcomeIo} alt="" sizes="220px" style={{ width: "100%", height: "auto", maxWidth: "100%" }} />
      <p className={styles.signInTitle}>Sign in for bulk grading</p>
      <p className="hint">Grade a whole class from photos, PDF, Word or Excel, then download the scores. Still free.</p>
      <Link href="/sign-in" className="btn btn-primary btn-sm">
        Sign in
      </Link>
    </div>
  );
}

function themeItems(theme: string) {
  return [
    { label: "Light", icon: <Icon name="light_mode" />, onSelect: () => setTheme("light"), checked: theme === "light" },
    { label: "Dark", icon: <Icon name="dark_mode" />, onSelect: () => setTheme("dark"), checked: theme === "dark" },
    { label: "System", icon: <Icon name="contrast" />, onSelect: () => setTheme("system"), checked: theme === "system" },
  ];
}

function ThemeMenu() {
  const theme = useTheme();
  return (
    <Menu
      label="Theme"
      trigger={
        <>
          <Icon name="contrast" /> <span className={styles.footLabel}>Theme</span>
        </>
      }
      items={themeItems(theme)}
    />
  );
}

function AccountMenu() {
  const { profile } = useAccount();
  const { signOut } = useClerk();
  const router = useRouter();
  const theme = useTheme();
  const name = profile?.displayName || profile?.email || "Account";

  return (
    <Menu
      label="Account menu"
      trigger={
        <>
          <span className={styles.avatar} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.footText}>
            <span className={styles.footLabel}>{name}</span>
            {profile && <span className="hint">{profile.role[0]!.toUpperCase() + profile.role.slice(1)}</span>}
          </span>
          <Icon name="unfold_more" className="muted" />
        </>
      }
      items={[
        { label: "Account", icon: <Icon name="person" />, onSelect: () => router.push("/account") },
        { label: "Help", icon: <Icon name="help" />, onSelect: () => router.push("/help") },
        ...(profile?.role === "admin"
          ? [{ label: "Analytics", icon: <Icon name="monitoring" />, onSelect: () => router.push("/admin") }]
          : []),
        "separator",
        ...themeItems(theme),
        "separator",
        { label: "Sign out", icon: <Icon name="logout" />, onSelect: () => void signOut({ redirectUrl: "/" }) },
      ]}
    />
  );
}
