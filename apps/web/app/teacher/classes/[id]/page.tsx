"use client";

import { type FormEvent, type ReactNode, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toDataURL } from "qrcode";
import {
  ASSIGNMENT_STATUS_LABEL,
  ApiError,
  CLASS_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type AssignmentStatus,
  type ClassDetail,
  type ClassInvitationRow,
  type ClassMemberRow,
  type InviteLinkRow,
  addClassMember,
  cancelClassInvitation,
  createInviteLink,
  deleteClass,
  getClass,
  removeClassMember,
  revokeInviteLink,
  updateClass,
} from "../../../../lib/idest";
import { day } from "../../../../lib/format";
import { useAction, useResource } from "../../../../lib/use-api";
import { ActionMenu, Blank, Notice, Pager, Shell, WaitingRack, Wizard, board as s } from "../../../../components/board";
import v from "../../../../components/list-toolbar.module.css";
import { classTabFromParam, type ClassTab } from "../../../../lib/tour";
import { inviteErrorMessage, isInviteExpired } from "../../../../lib/invitations";
import c from "../classes.module.css";

const PAGE_SIZE = 8;

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

/** One client-side page of a filtered list, clamped when the list shrinks. */
function usePagedList<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  return { page: current, totalPages, rows: paginate(items, current, PAGE_SIZE), setPage };
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className={`${v.control} ${v.searchControl}`}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={v.search}>
        <span className={v.searchIcon} aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          className={v.searchInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {value ? (
          <button type="button" className={v.searchClear} onClick={() => onChange("")} aria-label="Xóa từ khóa">
            ×
          </button>
        ) : null}
      </span>
    </label>
  );
}

interface Confirmation {
  title: string;
  body: ReactNode;
  action: string;
  run: () => Promise<void>;
}

export default function ClassDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = use(params);
  const initialTab = classTabFromParam(use(searchParams).tab);
  const { data, state, error, reload } = useResource<ClassDetail>((token) => getClass(token, id), [id]);

  return (
    <Shell role="teacher" wide>
      {state === "loading" && !data ? <WaitingRack /> : null}
      {state === "error" && !data ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href="/teacher/classes" className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về danh sách lớp
          </Link>
        </>
      ) : null}
      {data ? <ClassBody klass={data} onChanged={reload} initialTab={initialTab} /> : null}
    </Shell>
  );
}

function ClassBody({
  klass,
  onChanged,
  initialTab,
}: {
  klass: ClassDetail;
  onChanged: () => Promise<void>;
  initialTab: ClassTab;
}) {
  const { busy, error, setError, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(klass.name);
  const [description, setDescription] = useState(klass.description ?? "");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ClassTab>(initialTab);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // Keep ?tab= in step so a refresh or a shared link opens the same tab.
  const selectTab = (tab: ClassTab) => {
    setActiveTab(tab);
    const qs = new URLSearchParams(window.location.search);
    qs.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${qs.toString()}`);
  };

  const openEdit = () => {
    setName(klass.name);
    setDescription(klass.description ?? "");
    setError(null);
    setEditing(true);
  };

  const saveEdit = useCallback(async () => {
    if (!name.trim()) return;
    const done = await run((token) => updateClass(token, klass.id, { name: name.trim(), description: description.trim() }));
    if (done) {
      setEditing(false);
      await onChanged();
    }
  }, [klass.id, name, description, run, onChanged]);

  const toggleArchive = useCallback(async () => {
    const done = await run((token) =>
      updateClass(token, klass.id, { status: klass.status === "active" ? "archived" : "active" }),
    );
    if (done) await onChanged();
  }, [klass.id, klass.status, run, onChanged]);

  const confirmDelete = () => {
    setError(null);
    setConfirmation({
      title: "Xóa lớp?",
      body: (
        <>
          Xóa hẳn lớp &quot;{klass.name}&quot;? Bài tập của lớp phải đóng hết trước. Không thể hoàn tác.
        </>
      ),
      action: "Xóa lớp",
      run: async () => {
        const done = await run((token) => deleteClass(token, klass.id));
        if (done) window.location.href = "/teacher/classes";
      },
    });
  };

  const addMember = useCallback(async () => {
    const email = memberEmail.trim();
    if (!email) {
      setMemberError("Nhập email học viên.");
      return;
    }
    setMemberError(null);
    setMemberNotice(null);
    const result = await run(async (token) => {
      try {
        return await addClassMember(token, klass.id, email);
      } catch (err) {
        // 503: the email could not be sent; 409: an account owns it. Nothing was kept.
        const friendly = err instanceof ApiError ? inviteErrorMessage(err.status) : null;
        if (err instanceof ApiError && friendly) throw new ApiError(err.status, friendly);
        throw err;
      }
    });
    if (result) {
      setMemberEmail("");
      setMemberNotice(
        result.outcome === "added"
          ? `Đã thêm ${result.member.student.displayName} vào lớp.`
          : `Chưa có tài khoản với ${result.invitation.email} — đã gửi email mời. Học viên sẽ tự vào lớp khi đăng ký.`,
      );
      await onChanged();
    }
  }, [klass.id, memberEmail, run, onChanged]);

  const confirmCancelInvitation = (invitation: ClassInvitationRow) => {
    setError(null);
    setConfirmation({
      title: "Hủy lời mời?",
      body: <>Email {invitation.email} sẽ không còn tự vào lớp khi đăng ký.</>,
      action: "Hủy lời mời",
      run: async () => {
        const done = await run((token) => cancelClassInvitation(token, klass.id, invitation.id));
        if (done) {
          setConfirmation(null);
          await onChanged();
        }
      },
    });
  };

  const confirmRemoveMember = (member: ClassMemberRow) => {
    setError(null);
    setConfirmation({
      title: "Xóa học viên khỏi lớp?",
      body: (
        <>
          {member.student.displayName} sẽ không thấy bài tập riêng của lớp nữa. Bài đã nộp và kết quả đã duyệt vẫn
          được giữ.
        </>
      ),
      action: "Xóa khỏi lớp",
      run: async () => {
        const done = await run((token) => removeClassMember(token, klass.id, member.student.id));
        if (done) {
          setConfirmation(null);
          await onChanged();
        }
      },
    });
  };

  const makeInviteLink = useCallback(async () => {
    const link = await run((token) => createInviteLink(token, klass.id, { label: inviteLabel.trim() || undefined }));
    if (link) {
      setInviteLabel("");
      setNewLinkUrl(`${origin}/join/${link.token}`);
      await onChanged();
    }
  }, [klass.id, inviteLabel, run, onChanged, origin]);

  const confirmRevokeLink = (link: InviteLinkRow) => {
    setError(null);
    setConfirmation({
      title: "Xóa liên kết mời?",
      body: (
        <>
          Liên kết &quot;{link.label || "Liên kết mời"}&quot; sẽ ngừng hoạt động. Học viên đã vào lớp qua liên kết này
          vẫn ở trong lớp.
        </>
      ),
      action: "Xóa liên kết",
      run: async () => {
        const done = await run((token) => revokeInviteLink(token, link.id));
        if (done) {
          setConfirmation(null);
          await onChanged();
        }
      },
    });
  };

  const activeMembers = klass.members.filter((m) => !m.removedAt);
  const invitations = klass.invitations ?? [];

  const tabs: Array<{ id: ClassTab; label: string; count: number }> = [
    { id: "students", label: "Học viên", count: activeMembers.length },
    { id: "assignments", label: "Bài tập", count: klass.assignments.length },
    { id: "invites", label: "Liên kết mời", count: klass.inviteLinks.length },
  ];

  return (
    <>
      <Link href="/teacher/classes" className={s.crumbBack}>
        ← Tất cả lớp
      </Link>

      <header className={c.deskHead}>
        <div className={c.deskTitleRow}>
          <span
            className={klass.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`}
            style={{ marginTop: 0 }}
          >
            {CLASS_STATUS_LABEL[klass.status]}
          </span>
          <h1 className={s.title}>{klass.name}</h1>
          <span className={c.deskMenu}>
            <ActionMenu label="Tùy chọn lớp">
              <button type="button" className={s.actionMenuItem} onClick={openEdit}>
                Sửa tên/mô tả
              </button>
              <button type="button" className={s.actionMenuItem} disabled={busy} onClick={toggleArchive}>
                {klass.status === "active" ? "Lưu trữ lớp" : "Mở lại lớp"}
              </button>
              <button
                type="button"
                className={`${s.actionMenuItem} ${s.actionMenuItemAlert}`}
                onClick={confirmDelete}
              >
                Xóa lớp
              </button>
            </ActionMenu>
          </span>
        </div>
        <p className={c.deskDesc}>{klass.description || "Chưa có mô tả cho lớp này."}</p>
        <p className={c.deskMeta}>tạo {day(klass.createdAt)}</p>

        <dl className={c.deskStats}>
          {tabs.map((tab) => (
            <div key={tab.id} className={c.deskStat}>
              <dt>{tab.label}</dt>
              <dd>{tab.count}</dd>
            </div>
          ))}
          <div className={c.deskStat}>
            <dt>Đang chờ đăng ký</dt>
            <dd>{invitations.length}</dd>
          </div>
        </dl>
      </header>

      {klass.status === "archived" ? (
        <Notice>Lớp đang lưu trữ: liên kết mời của lớp tạm ngừng hoạt động. Mở lại lớp trong menu tùy chọn lớp để dùng lại.</Notice>
      ) : null}
      {error && !confirmation && !editing ? <Notice tone="alert">{error}</Notice> : null}

      <Wizard
        open={editing}
        onClose={() => setEditing(false)}
        title="Sửa tên/mô tả lớp"
        footer={
          <>
            <button type="button" className={s.pressQuiet} onClick={() => setEditing(false)}>
              Hủy
            </button>
            <button type="button" className={s.press} disabled={busy || !name.trim()} onClick={saveEdit}>
              {busy ? "Đang lưu…" : "Lưu"}
            </button>
          </>
        }
      >
        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor="cn">
            Tên lớp
          </label>
          <input id="cn" className={s.field} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor="cd">
            Mô tả
          </label>
          <textarea
            id="cd"
            className={s.field}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error ? <Notice tone="alert">{error}</Notice> : null}
      </Wizard>

      <Wizard
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        title={confirmation?.title ?? ""}
        footer={
          <>
            <button type="button" className={s.pressQuiet} onClick={() => setConfirmation(null)}>
              Hủy
            </button>
            <button
              type="button"
              className={s.pressDanger}
              disabled={busy}
              onClick={() => void confirmation?.run()}
            >
              {busy ? "Đang xử lý…" : confirmation?.action}
            </button>
          </>
        }
      >
        <p className={c.confirmText}>{confirmation?.body}</p>
        {error ? <Notice tone="alert">{error}</Notice> : null}
      </Wizard>

      <div className={s.classTabs} role="tablist" aria-label="Mục của lớp">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`class-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`class-panel-${tab.id}`}
            className={`${s.classTab} ${activeTab === tab.id ? s.classTabActive : ""}`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label} <span className={s.classTabCount}>{tab.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`class-panel-${activeTab}`} aria-labelledby={`class-tab-${activeTab}`}>
        {activeTab === "students" ? (
          <StudentsPanel
            members={activeMembers}
            invitations={invitations}
            busy={busy}
            onRemove={confirmRemoveMember}
            onCancelInvitation={confirmCancelInvitation}
            memberEmail={memberEmail}
            onMemberEmailChange={setMemberEmail}
            onAddMember={addMember}
            memberError={memberError}
            memberNotice={memberNotice}
            onOpenInvites={() => selectTab("invites")}
          />
        ) : null}

        {activeTab === "assignments" ? <AssignmentsPanel assignments={klass.assignments} /> : null}

        {activeTab === "invites" ? (
          <InviteLinksPanel
            links={klass.inviteLinks}
            busy={busy}
            onRevoke={confirmRevokeLink}
            inviteLabel={inviteLabel}
            onInviteLabelChange={setInviteLabel}
            onCreate={makeInviteLink}
            newLinkUrl={newLinkUrl}
            origin={origin}
          />
        ) : null}
      </div>
    </>
  );
}

function StudentsPanel({
  members,
  invitations,
  busy,
  onRemove,
  onCancelInvitation,
  memberEmail,
  onMemberEmailChange,
  onAddMember,
  memberError,
  memberNotice,
  onOpenInvites,
}: {
  members: ClassMemberRow[];
  invitations: ClassInvitationRow[];
  busy: boolean;
  onRemove: (member: ClassMemberRow) => void;
  onCancelInvitation: (invitation: ClassInvitationRow) => void;
  memberEmail: string;
  onMemberEmailChange: (v: string) => void;
  onAddMember: () => void;
  memberError: string | null;
  memberNotice: string | null;
  onOpenInvites: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.student.displayName.toLowerCase().includes(q) || m.student.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  const { page, totalPages, rows, setPage } = usePagedList(filtered);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAddMember();
  };

  return (
    <div className={c.panelLayout}>
      <div className={c.panelMain}>
        {members.length === 0 ? (
          <Blank art="reading" title="Lớp chưa có học viên">
            Mời bằng email ở bên cạnh, hoặc gửi{" "}
            <button type="button" className={v.inlineLink} onClick={onOpenInvites}>
              liên kết mời
            </button>
            .
          </Blank>
        ) : (
          <>
            <div className={c.panelTools}>
              <SearchBox
                label="Tìm học viên"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
                placeholder="Tên hoặc email"
              />
              <span className={v.range}>
                {filtered.length} / {members.length} học viên
              </span>
            </div>

            {rows.length === 0 ? (
              <p className={c.emptyLine}>Không khớp học viên nào.</p>
            ) : (
              <div className={c.roster}>
                {rows.map((m) => (
                  <div key={m.id} className={c.rosterRow}>
                    <span className={s.studentAvatar} aria-hidden="true">
                      {initials(m.student.displayName)}
                    </span>
                    <span className={s.studentInfo}>
                      <span className={s.studentName}>{m.student.displayName}</span>
                      <span className={s.studentEmail}>{m.student.email}</span>
                    </span>
                    <span className={s.studentJoined}>vào lớp {day(m.joinedAt)}</span>
                    <button
                      type="button"
                      className={c.rowAction}
                      disabled={busy}
                      onClick={() => onRemove(m)}
                      aria-label={`Xóa ${m.student.displayName} khỏi lớp`}
                    >
                      Xóa khỏi lớp
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Pager page={page} totalPages={totalPages} onPage={setPage} label="Trang học viên" />
          </>
        )}
      </div>

      <aside className={c.panelSide}>
        <form className={c.sideCard} onSubmit={submit} data-tour="invite-student">
          <h3 className={c.sideTitle}>Mời học viên bằng email</h3>
          <p className={c.sideHint}>
            Đã có tài khoản thì vào lớp ngay; chưa có thì nhận email mời và tự vào lớp khi đăng ký.
          </p>
          <label className={s.fieldLabel} htmlFor="add-member">
            Email
          </label>
          <input
            id="add-member"
            type="email"
            className={s.field}
            value={memberEmail}
            onChange={(e) => onMemberEmailChange(e.target.value)}
            placeholder="hocvien@example.com"
          />
          <button type="submit" className={`${s.press} ${c.sideSubmit}`} disabled={busy || !memberEmail.trim()}>
            {busy ? "Đang mời…" : "Thêm"}
          </button>
          {memberError ? <Notice tone="alert">{memberError}</Notice> : null}
          {memberNotice ? <Notice tone="ok">{memberNotice}</Notice> : null}
        </form>

        {invitations.length > 0 ? (
          <div className={c.sideCard}>
            <h3 className={c.sideTitle}>
              Đang chờ đăng ký <span className={v.tabCount}>{invitations.length}</span>
            </h3>
            <ul className={c.pendingList}>
              {invitations.map((inv) => {
                const expired = isInviteExpired(inv.createdAt);
                return (
                  <li key={inv.id} className={c.pendingRow}>
                    <span className={c.pendingInfo}>
                      <span className={c.pendingEmail}>{inv.email}</span>
                      <span className={expired ? c.pendingExpired : c.pendingMeta}>
                        {expired ? "hết hạn — nhập lại email để gửi lại" : `mời ${day(inv.createdAt)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={c.rowAction}
                      disabled={busy}
                      onClick={() => onCancelInvitation(inv)}
                      aria-label={`Hủy lời mời ${inv.email}`}
                    >
                      Hủy
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function AssignmentsPanel({ assignments }: { assignments: Assignment[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AssignmentStatus | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assignments, query, status]);

  const { page, totalPages, rows, setPage } = usePagedList(filtered);

  if (assignments.length === 0) {
    return (
      <div className={s.classPanel}>
        <Blank art="reading" title="Lớp chưa có bài tập riêng">
          Khi ra đề ở trang{" "}
          <Link href="/teacher/assignments" className={v.inlineLink}>
            Bài tập
          </Link>
          , chọn lớp này để chỉ học viên trong lớp mới thấy đề.
        </Blank>
      </div>
    );
  }

  return (
    <div className={s.classPanel}>
      <div className={c.panelTools}>
        <SearchBox
          label="Tìm bài tập"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Tiêu đề bài tập"
        />
        <label className={v.control}>
          <span className={s.fieldLabel}>Trạng thái</span>
          <select
            className={s.paperFilterSelect}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AssignmentStatus | "all");
              setPage(1);
            }}
          >
            <option value="all">Tất cả</option>
            {(Object.keys(ASSIGNMENT_STATUS_LABEL) as AssignmentStatus[]).map((st) => (
              <option key={st} value={st}>
                {ASSIGNMENT_STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </label>
        <span className={v.range}>
          {filtered.length} / {assignments.length} bài tập
        </span>
      </div>

      {rows.length === 0 ? (
        <p className={c.emptyLine}>Không khớp bài tập nào.</p>
      ) : (
        <div className={s.paperGrid}>
          {rows.map((a) => (
            <Link key={a.id} href={`/teacher/assignments/${a.id}`} className={`${s.paperCard} ${c.classCard}`}>
              <span className={s.paperTag}>{TASK_TYPE_LABEL[a.taskType]}</span>
              <span className={s.paperTitle}>{a.title}</span>
              <span
                className={a.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`}
              >
                {ASSIGNMENT_STATUS_LABEL[a.status]}
              </span>
              <span className={c.classFoot}>
                <span>hạn {day(a.dueAt)}</span>
                <span className={c.classGo} aria-hidden="true">
                  Xem bài nộp →
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <Pager page={page} totalPages={totalPages} onPage={setPage} label="Trang bài tập của lớp" />
    </div>
  );
}

function InviteLinksPanel({
  links,
  busy,
  onRevoke,
  inviteLabel,
  onInviteLabelChange,
  onCreate,
  newLinkUrl,
  origin,
}: {
  links: InviteLinkRow[];
  busy: boolean;
  onRevoke: (link: InviteLinkRow) => void;
  inviteLabel: string;
  onInviteLabelChange: (v: string) => void;
  onCreate: () => void;
  newLinkUrl: string | null;
  origin: string;
}) {
  const [query, setQuery] = useState("");
  const [qrByLink, setQrByLink] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => (l.label ?? "").toLowerCase().includes(q) || l.token.toLowerCase().includes(q));
  }, [links, query]);

  const { page, totalPages, rows, setPage } = usePagedList(filtered);
  const rowIds = rows.map((r) => r.id).join(",");

  useEffect(() => {
    let cancelled = false;
    rows.forEach((link) => {
      if (qrByLink[link.id]) return;
      const url = `${origin}/join/${link.token}`;
      toDataURL(url, { margin: 1, width: 200 })
        .then((dataUrl) => {
          if (!cancelled) setQrByLink((prev) => ({ ...prev, [link.id]: dataUrl }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds, origin]);

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1500);
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      // Clipboard unavailable in this browser context — nothing more to do.
    }
  };

  const copyQr = async (link: InviteLinkRow) => {
    const dataUrl = qrByLink[link.id];
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash(`${link.id}:qr`);
    } catch {
      // Image clipboard write unsupported — open the QR so it can be saved manually.
      window.open(dataUrl, "_blank");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate();
  };

  return (
    <div className={s.classPanel}>
      <form className={c.createBar} onSubmit={submit} data-tour="invite-link">
        <label className={`${v.control} ${c.createField}`}>
          <span className={s.fieldLabel}>Nhãn liên kết (tùy chọn)</span>
          <input
            className={s.field}
            value={inviteLabel}
            onChange={(e) => onInviteLabelChange(e.target.value)}
            placeholder="Ví dụ: Nhóm buổi tối"
          />
        </label>
        <button type="submit" className={s.press} disabled={busy}>
          {busy ? "Đang tạo…" : "Tạo liên kết mời"}
        </button>
      </form>
      {newLinkUrl ? (
        <Notice tone="ok">
          Đã tạo: <span className={s.figure}>{newLinkUrl}</span> — gửi cho học viên để họ tự vào lớp.{" "}
          <button type="button" className={v.inlineLink} onClick={() => copyText("new", newLinkUrl)}>
            {copied === "new" ? "Đã chép!" : "Copy link"}
          </button>
        </Notice>
      ) : null}

      {links.length === 0 ? (
        <Blank art="reading" title="Chưa có liên kết mời nào">
          Tạo liên kết ở trên để học viên tự vào lớp bằng đường dẫn hoặc mã QR.
        </Blank>
      ) : (
        <>
          <div className={c.panelTools}>
            <SearchBox
              label="Tìm liên kết"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="Nhãn liên kết"
            />
            <span className={v.range}>
              {filtered.length} / {links.length} liên kết
            </span>
          </div>

          {rows.length === 0 ? (
            <p className={c.emptyLine}>Không khớp liên kết nào.</p>
          ) : (
            <div className={c.inviteGrid}>
              {rows.map((link) => {
                const url = `${origin}/join/${link.token}`;
                const full = link.maxUses !== null && link.useCount >= link.maxUses;
                const expired = link.expiresAt !== null && new Date(link.expiresAt).getTime() < Date.now();
                return (
                  <div key={link.id} className={c.inviteCard}>
                    {qrByLink[link.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrByLink[link.id]} alt={`Mã QR của ${link.label || "liên kết mời"}`} className={c.inviteQr} />
                    ) : (
                      <span className={c.inviteQr} aria-hidden="true" />
                    )}
                    <div className={c.inviteBody}>
                      <span className={c.inviteName}>{link.label || "Liên kết mời"}</span>
                      <span className={c.inviteUrl} title={url}>
                        {url}
                      </span>
                      <span className={c.inviteUses}>
                        đã dùng <strong>{link.useCount}</strong>
                        {link.maxUses ? ` / ${link.maxUses}` : ""} lần
                        {full ? <span className={c.inviteFull}> · đã đủ lượt</span> : null}
                        {expired ? <span className={c.inviteFull}> · đã hết hạn</span> : null}
                        {!expired && link.expiresAt ? ` · hết hạn ${day(link.expiresAt)}` : null}
                      </span>
                      <span className={c.inviteActions}>
                        <button type="button" className={s.pressQuiet} onClick={() => copyText(`${link.id}:link`, url)}>
                          {copied === `${link.id}:link` ? "Đã chép!" : "Copy link"}
                        </button>
                        <button
                          type="button"
                          className={s.pressQuiet}
                          disabled={!qrByLink[link.id]}
                          onClick={() => copyQr(link)}
                        >
                          {copied === `${link.id}:qr` ? "Đã chép!" : "Copy QR"}
                        </button>
                        <button
                          type="button"
                          className={c.rowAction}
                          disabled={busy}
                          onClick={() => onRevoke(link)}
                        >
                          Xóa
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Pager page={page} totalPages={totalPages} onPage={setPage} label="Trang liên kết mời" />
        </>
      )}
    </div>
  );
}
