"use client";

import { type FormEvent, useCallback, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import type { Role } from "@repo/auth-contract";
import {
  type Profile,
  deleteAccount,
  getProfile,
  updateProfile,
} from "../../lib/idest";
import { MAX_DISPLAY_NAME, validateDisplayName } from "../../lib/profile";
import { day } from "../../lib/format";
import { useAction, useResource } from "../../lib/use-api";
import { Notice, Shell, WaitingRack, board as s } from "../../components/board";

const ROLE_LABEL: Record<Role, string> = {
  student: "Học viên",
  teacher: "Giáo viên",
  admin: "Quản trị",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Đang hoạt động",
  suspended: "Tạm khóa",
  deleted: "Đã xóa",
};

export default function SettingsPage() {
  const { data, state, error, reload, setData } = useResource<Profile>((token) => getProfile(token));

  return (
    <Shell role={data?.role}>
      <h1 className={s.title}>Cài đặt</h1>
      <p className={s.subtitle}>Hồ sơ cá nhân và tài khoản của bạn.</p>

      {state === "loading" ? <WaitingRack rows={1} /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <div className={s.actionRow}>
            <button type="button" className={s.pressQuiet} onClick={() => void reload()}>
              Thử lại
            </button>
          </div>
        </>
      ) : null}

      {state === "ready" && data ? (
        <>
          <ProfileForm profile={data} onSaved={setData} />
          {data.role === "teacher" ? (
            <>
              <DangerZone profile={data} />
            </>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const { busy, error: actionError, run } = useAction();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const value = displayName ?? profile.displayName;
  const dirty = value.trim() !== profile.displayName;

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const problem = validateDisplayName(value);
      if (problem) {
        setFormError(problem);
        return;
      }
      setFormError(null);
      const updated = await run((token) => updateProfile(token, value.trim()));
      if (updated) {
        onSaved(updated);
        setDisplayName(null);
        setSaved(true);
      }
    },
    [value, run, onSaved],
  );

  return (
    <form className={s.railBlock} onSubmit={save} style={{ marginTop: "1.25rem" }}>
      <div className={s.sectionHead} style={{ marginTop: 0 }}>
        <h2 className={s.sectionTitle}>Hồ sơ</h2>
      </div>
      <div className={s.fieldRow}>
        <label className={s.fieldLabel} htmlFor="displayName">
          Tên hiển thị
        </label>
        <input
          id="displayName"
          className={s.field}
          value={value}
          maxLength={MAX_DISPLAY_NAME}
          disabled={busy}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      <div className={s.criterion} style={{ gridTemplateColumns: "1fr auto" }}>
        <span className={s.criterionName}>Email</span>
        <span className={s.figure}>{profile.email}</span>
      </div>
      <div className={s.criterion} style={{ gridTemplateColumns: "1fr auto" }}>
        <span className={s.criterionName}>Vai trò</span>
        <span className={s.figure}>{ROLE_LABEL[profile.role]}</span>
      </div>
      <div className={s.criterion} style={{ gridTemplateColumns: "1fr auto" }}>
        <span className={s.criterionName}>Trạng thái</span>
        <span className={s.figure}>{STATUS_LABEL[profile.status] ?? profile.status}</span>
      </div>
      <div className={s.criterion} style={{ gridTemplateColumns: "1fr auto" }}>
        <span className={s.criterionName}>Tham gia</span>
        <span className={s.figure}>{day(profile.createdAt)}</span>
      </div>

      {formError ? <Notice tone="alert">{formError}</Notice> : null}
      {actionError ? <Notice tone="alert">{actionError}</Notice> : null}
      {saved ? <Notice tone="ok">Đã lưu tên hiển thị.</Notice> : null}

      <div className={s.actionRow}>
        <button type="submit" className={s.press} disabled={!dirty || busy}>
          {busy ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}

function DangerZone({ profile }: { profile: Profile }) {
  const { signOut } = useClerk();
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [leaving, setLeaving] = useState(false);

  const matches = confirmEmail.trim().toLowerCase() === profile.email.toLowerCase();

  const remove = useCallback(async () => {
    const summary = await run((token) => deleteAccount(token, confirmEmail.trim()));
    if (!summary) return;
    setLeaving(true);
    // The Clerk identity is gone by now, so signOut may reject on a session it
    // can no longer reach. Either way the browser leaves for the landing page.
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.href = "/";
    }
  }, [confirmEmail, run, signOut]);

  return (
    <>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Vùng nguy hiểm</h2>
      </div>
      <div className={s.dangerBlock}>
        {open ? (
          <>
            <p className={s.fieldHint}>
              Xóa tài khoản sẽ gỡ khỏi bảng chấm: các đề bài bạn đã ra, các lớp và liên kết mời của
              bạn, cùng tài khoản của những học viên chỉ học với riêng bạn. Học viên còn đang học
              với giáo viên khác vẫn giữ tài khoản, chỉ rời lớp của bạn.
            </p>
            <p className={s.fieldHint}>
              Bài viết đã nộp và kết quả đã duyệt được giữ nguyên. Sau khi xóa, bạn và các học viên
              đó không đăng nhập lại được nữa.
            </p>
            <div className={s.fieldRow}>
              <label className={s.fieldLabel} htmlFor="confirm-email">
                Nhập lại email của bạn để xác nhận
              </label>
              <input
                id="confirm-email"
                className={s.field}
                type="email"
                autoComplete="off"
                value={confirmEmail}
                disabled={busy || leaving}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={profile.email}
              />
            </div>
            {error ? <Notice tone="alert">{error}</Notice> : null}
            {leaving ? <Notice tone="ok">Đã xóa tài khoản. Đang đăng xuất…</Notice> : null}
            <div className={s.actionRow}>
              <button
                type="button"
                className={s.pressDanger}
                disabled={!matches || busy || leaving}
                onClick={() => void remove()}
              >
                {busy || leaving ? "Đang xóa…" : "Xóa vĩnh viễn"}
              </button>
              <button
                type="button"
                className={s.pressQuiet}
                disabled={busy || leaving}
                onClick={() => {
                  setOpen(false);
                  setConfirmEmail("");
                }}
              >
                Hủy
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={s.fieldHint}>
              Đóng bảng chấm này vĩnh viễn. Không hoàn tác được.
            </p>
            <div className={s.actionRow}>
              <button type="button" className={s.pressQuiet} onClick={() => setOpen(true)}>
                Xóa tài khoản
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
