"use client";

import { useClerk } from "@clerk/nextjs";
import { useState, type FormEvent } from "react";
import { describeError, type Profile } from "../lib/api";
import { shortDate } from "../lib/format";
import { useApi } from "../lib/use-api";
import { Icon } from "./icon";
import { useAccount } from "./session";
import { useToast } from "./toast";

export function AccountView() {
  const { profile, reloadProfile } = useAccount();
  if (!profile) return null;
  return (
    <div className="page page-narrow">
      <h1 className="page-title">Account</h1>
      <NameForm key={profile.displayName} profile={profile} onSaved={reloadProfile} />
      {profile.role === "teacher" && <DeleteAccount email={profile.email} />}
    </div>
  );
}

function NameForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const api = useApi();
  const [name, setName] = useState(profile.displayName);
  const toast = useToast();
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api.updateMe(name.trim());
      setState({});
      toast("Name saved.");
      onSaved();
    } catch (err) {
      setState({ error: describeError(err) });
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ fontSize: "var(--fs-18)" }}>Profile</h2>
      <div className="field">
        <label className="label" htmlFor="display-name">
          Name
        </label>
        <input
          id="display-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          autoComplete="name"
        />
      </div>
      <p className="hint">
        {profile.email} · {profile.role[0]!.toUpperCase() + profile.role.slice(1)} · joined {shortDate(profile.createdAt)}
      </p>
      <div className="row">
        <button className="btn btn-primary" disabled={state.busy || !name.trim() || name.trim() === profile.displayName}>
          {state.busy ? "Saving" : "Save"}
        </button>
      </div>
      {state.error && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {state.error}
        </p>
      )}
    </form>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const api = useApi();
  const { signOut } = useClerk();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteMe(confirm.trim());
      await signOut({ redirectUrl: "/" });
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={remove} style={{ borderColor: "var(--danger)" }}>
      <h2 style={{ fontSize: "var(--fs-18)" }}>Delete account</h2>
      <p className="muted">
        This closes your account and signs you out. Essays and scores stay stored, but you won&apos;t be able to
        sign in or open them again.
      </p>
      <div className="field">
        <label className="label" htmlFor="confirm-email">
          Type your email to confirm
        </label>
        <input
          id="confirm-email"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={email}
          autoComplete="off"
        />
      </div>
      <button
        className="btn btn-danger"
        style={{ justifySelf: "start" }}
        disabled={busy || confirm.trim().toLowerCase() !== email.toLowerCase()}
      >
        {busy ? "Deleting" : "Delete my account"}
      </button>
      {error && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error}
        </p>
      )}
    </form>
  );
}
