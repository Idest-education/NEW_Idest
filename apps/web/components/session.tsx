"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "../lib/api";
import { roleAllows, type Access } from "../lib/access";
import { useApi, useLoad } from "../lib/use-api";
import { Io, type IoMood } from "./io";

interface Account {
  loaded: boolean;
  signedIn: boolean;
  /** Read from the server, which also creates the user row on first sign-in. */
  profile?: Profile;
  profileError?: string;
  reloadProfile: () => void;
  /** Bumped after a new grading or batch, so the sidebar refetches. */
  recentsVersion: number;
  bumpRecents: () => void;
}

const AccountContext = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const api = useApi();
  const me = useLoad(isSignedIn ? `me:${userId}` : null, api.me);
  const [recentsVersion, setRecentsVersion] = useState(0);
  const bumpRecents = useCallback(() => setRecentsVersion((v) => v + 1), []);
  const value = useMemo<Account>(
    () => ({
      loaded: isLoaded,
      signedIn: Boolean(isSignedIn),
      profile: me.data,
      profileError: me.error,
      reloadProfile: me.reload,
      recentsVersion,
      bumpRecents,
    }),
    [isLoaded, isSignedIn, me.data, me.error, me.reload, recentsVersion, bumpRecents],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount needs <AccountProvider>");
  return account;
}

export const isTeacher = (p?: Profile) => p?.role === "teacher" || p?.role === "admin";

/** Shows children once the server confirms the role. Never redirects, so a brand-new account is not bounced. */
export function RoleGate({ access, children }: { access: Access; children: ReactNode }) {
  const { loaded, signedIn, profile, profileError, reloadProfile } = useAccount();

  if (loaded && !signedIn) {
    return (
      <Notice io="idle" title="Sign in to continue">
        <Link className="btn btn-primary" href="/sign-in">
          Sign in
        </Link>
      </Notice>
    );
  }
  if (profileError && !profile) {
    return (
      <Notice io="oops" title="We couldn't load your account" body={profileError}>
        <button className="btn btn-secondary" onClick={reloadProfile}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!profile) {
    return (
      <div className="page page-narrow" aria-busy="true" style={{ justifyItems: "center", paddingTop: 80 }}>
        <Io mood="busy" size={80} />
        <p className="muted" role="status">
          Setting up your account…
        </p>
      </div>
    );
  }
  if (!roleAllows(access, profile.role)) {
    return (
      <Notice
        io="lost"
        title={access === "admin" ? "This page is for admins" : "Bulk grading is for teacher accounts"}
        body="You can still grade single essays from the home page."
      >
        <Link className="btn btn-primary" href="/">
          Go to grading
        </Link>
      </Notice>
    );
  }
  return children;
}

export function Notice({
  io,
  title,
  body,
  children,
}: {
  io: IoMood;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page page-narrow">
      <div className="card stack" style={{ justifyItems: "start", padding: 32 }}>
        <Io mood={io} size={72} />
        <h1 style={{ fontSize: "var(--fs-22)" }}>{title}</h1>
        {body && <p className="muted">{body}</p>}
        {children && <div className="row">{children}</div>}
      </div>
    </div>
  );
}
