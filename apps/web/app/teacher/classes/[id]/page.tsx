"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
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
import { ActionMenu, Blank, Notice, Shell, WaitingRack, Wizard, board as s } from "../../../../components/board";
import { classTabFromParam, type ClassTab } from "../../../../lib/tour";

const PAGE_SIZE = 6;

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

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (next: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={s.pager}>
      <button type="button" className={s.pressQuiet} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Trước
      </button>
      <span className={s.pagerInfo}>
        Trang {page} / {totalPages}
      </span>
      <button
        type="button"
        className={s.pressQuiet}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Sau →
      </button>
    </div>
  );
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
      {state === "loading" ? <WaitingRack /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href="/teacher/classes" className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về danh sách lớp
          </Link>
        </>
      ) : null}
      {state === "ready" && data ? <ClassBody klass={data} onChanged={reload} initialTab={initialTab} /> : null}
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
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(klass.name);
  const [description, setDescription] = useState(klass.description ?? "");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ClassTab | null>(initialTab);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const saveEdit = useCallback(async () => {
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

  const remove = useCallback(async () => {
    const done = await run((token) => deleteClass(token, klass.id));
    if (done) window.location.href = "/teacher/classes";
  }, [klass.id, run]);

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
        // 503 = Clerk could not send the email; nothing was saved.
        if (err instanceof ApiError && err.status === 503) {
          throw new ApiError(503, "Không gửi được email mời. Thử lại sau.");
        }
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

  const cancelInvitation = useCallback(
    async (invitationId: string) => {
      const done = await run((token) => cancelClassInvitation(token, klass.id, invitationId));
      if (done) await onChanged();
    },
    [klass.id, run, onChanged],
  );

  const removeMember = useCallback(
    async (studentId: string) => {
      const done = await run((token) => removeClassMember(token, klass.id, studentId));
      if (done) await onChanged();
    },
    [klass.id, run, onChanged],
  );

  const makeInviteLink = useCallback(async () => {
    const link = await run((token) => createInviteLink(token, klass.id, { label: inviteLabel.trim() || undefined }));
    if (link) {
      setInviteLabel("");
      setNewLinkUrl(`${origin}/join/${link.token}`);
      await onChanged();
    }
  }, [klass.id, inviteLabel, run, onChanged, origin]);

  const revokeLink = useCallback(
    async (linkId: string) => {
      const done = await run((token) => revokeInviteLink(token, linkId));
      if (done) await onChanged();
    },
    [run, onChanged],
  );

  const activeMembers = klass.members.filter((m) => !m.removedAt);

  const toggleTab = (tab: ClassTab) => {
    setActiveTab((cur) => (cur === tab ? null : tab));
  };

  return (
    <>
      <Link href="/teacher/classes" className={s.crumbBack}>
        ← Tất cả lớp
      </Link>

      <div className={s.slugLine}>
        <span
          className={klass.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`}
          style={{ marginTop: 0 }}
        >
          {CLASS_STATUS_LABEL[klass.status]}
        </span>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          {klass.name}
        </h1>
        <ActionMenu label="Tùy chọn lớp">
          <button type="button" className={s.actionMenuItem} onClick={() => setEditing(true)}>
            Sửa tên/mô tả
          </button>
          <button type="button" className={s.actionMenuItem} disabled={busy} onClick={toggleArchive}>
            {klass.status === "active" ? "Lưu trữ lớp" : "Mở lại lớp"}
          </button>
          <button
            type="button"
            className={`${s.actionMenuItem} ${s.actionMenuItemAlert}`}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            Xóa lớp
          </button>
        </ActionMenu>
      </div>

      <div className={s.slugMeta} style={{ marginTop: "0.6rem" }}>
        <span>
          <span className={s.figure}>{activeMembers.length}</span> học viên
        </span>
        <span>
          <span className={s.figure}>{klass.assignments.length}</span> bài tập
        </span>
        <span>
          <span className={s.figure}>{klass.inviteLinks.length}</span> liên kết mời
        </span>
      </div>

      {klass.description ? <p className={s.subtitle}>{klass.description}</p> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}

      <Wizard
        open={editing}
        onClose={() => setEditing(false)}
        title="Sửa tên/mô tả lớp"
        footer={
          <>
            <button type="button" className={s.pressQuiet} onClick={() => setEditing(false)}>
              Hủy
            </button>
            <button type="button" className={s.press} disabled={busy} onClick={saveEdit}>
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
          <textarea id="cd" className={s.field} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error ? <Notice tone="alert">{error}</Notice> : null}
      </Wizard>

      <Wizard
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Xóa lớp?"
        footer={
          <>
            <button type="button" className={s.pressQuiet} onClick={() => setConfirmDeleteOpen(false)}>
              Hủy
            </button>
            <button type="button" className={s.press} disabled={busy} onClick={remove}>
              {busy ? "Đang xóa…" : "Xác nhận xóa"}
            </button>
          </>
        }
      >
        <p className={s.fieldHint}>
          Xóa hẳn lớp &quot;{klass.name}&quot;? Bài tập phải đóng hết trước. Không thể hoàn tác.
        </p>
        {error ? <Notice tone="alert">{error}</Notice> : null}
      </Wizard>

      <div className={s.classTabs}>
        <button
          type="button"
          className={`${s.classTab} ${activeTab === "students" ? s.classTabActive : ""}`}
          onClick={() => toggleTab("students")}
        >
          Học viên <span className={s.classTabCount}>{activeMembers.length}</span>
        </button>
        <button
          type="button"
          className={`${s.classTab} ${activeTab === "assignments" ? s.classTabActive : ""}`}
          onClick={() => toggleTab("assignments")}
        >
          Bài tập <span className={s.classTabCount}>{klass.assignments.length}</span>
        </button>
        <button
          type="button"
          className={`${s.classTab} ${activeTab === "invites" ? s.classTabActive : ""}`}
          onClick={() => toggleTab("invites")}
        >
          Liên kết mời <span className={s.classTabCount}>{klass.inviteLinks.length}</span>
        </button>
      </div>

      {activeTab === "students" ? (
        <StudentsPanel
          members={activeMembers}
          invitations={klass.invitations ?? []}
          busy={busy}
          onRemove={removeMember}
          onCancelInvitation={cancelInvitation}
          memberEmail={memberEmail}
          onMemberEmailChange={setMemberEmail}
          onAddMember={addMember}
          memberError={memberError}
          memberNotice={memberNotice}
        />
      ) : null}

      {activeTab === "assignments" ? <AssignmentsPanel assignments={klass.assignments} /> : null}

      {activeTab === "invites" ? (
        <InviteLinksPanel
          links={klass.inviteLinks}
          busy={busy}
          onRevoke={revokeLink}
          inviteLabel={inviteLabel}
          onInviteLabelChange={setInviteLabel}
          onCreate={makeInviteLink}
          newLinkUrl={newLinkUrl}
          origin={origin}
        />
      ) : null}
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
}: {
  members: ClassMemberRow[];
  invitations: ClassInvitationRow[];
  busy: boolean;
  onRemove: (studentId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  memberEmail: string;
  onMemberEmailChange: (v: string) => void;
  onAddMember: () => void;
  memberError: string | null;
  memberNotice: string | null;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.student.displayName.toLowerCase().includes(q) || m.student.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const rows = paginate(filtered, pageClamped, PAGE_SIZE);

  return (
    <div className={s.classPanel}>
      <div className={s.fieldRow} data-tour="invite-student">
        <label className={s.fieldLabel} htmlFor="add-member">
          Mời học viên bằng email
        </label>
        <div className={s.actionRow} style={{ marginTop: 0 }}>
          <input
            id="add-member"
            className={s.field}
            style={{ flex: "1 1 16rem" }}
            value={memberEmail}
            onChange={(e) => onMemberEmailChange(e.target.value)}
            placeholder="hocvien@example.com"
          />
          <button type="button" className={s.pressQuiet} disabled={busy} onClick={onAddMember}>
            Thêm
          </button>
        </div>
        {memberError ? <Notice tone="alert">{memberError}</Notice> : null}
        {memberNotice ? <Notice tone="ok">{memberNotice}</Notice> : null}
      </div>

      {members.length === 0 ? (
        <Blank art="reading" title="Lớp chưa có học viên">
          Thêm bằng email ở trên, hoặc gửi liên kết mời ở tab bên cạnh.
        </Blank>
      ) : (
        <>
          <div className={s.classPanelFilters}>
            <input
              className={s.field}
              style={{ maxWidth: "18rem" }}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo tên hoặc email"
            />
          </div>

          {rows.length === 0 ? (
            <p className={s.fieldHint}>Không khớp học viên nào.</p>
          ) : (
            <div className={s.studentList}>
              {rows.map((m) => (
                <div key={m.id} className={s.studentRow}>
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
                    className={s.pressQuiet}
                    disabled={busy}
                    onClick={() => onRemove(m.student.id)}
                  >
                    Xóa khỏi lớp
                  </button>
                </div>
              ))}
            </div>
          )}

          <Pager page={pageClamped} totalPages={totalPages} onPage={setPage} />
        </>
      )}

      {invitations.length > 0 ? (
        <div style={{ marginTop: "1.25rem" }}>
          <span className={s.fieldLabel}>Đang chờ đăng ký ({invitations.length})</span>
          <div className={s.studentList}>
            {invitations.map((inv) => (
              <div key={inv.id} className={s.studentRow}>
                <span className={s.studentAvatar} aria-hidden="true">
                  @
                </span>
                <span className={s.studentInfo}>
                  <span className={s.studentName}>{inv.email}</span>
                  <span className={s.studentEmail}>chưa có tài khoản</span>
                </span>
                <span className={s.studentJoined}>mời {day(inv.createdAt)}</span>
                <button
                  type="button"
                  className={s.pressQuiet}
                  disabled={busy}
                  onClick={() => onCancelInvitation(inv.id)}
                >
                  Hủy lời mời
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AssignmentsPanel({ assignments }: { assignments: Assignment[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AssignmentStatus | "all">("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assignments, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const rows = paginate(filtered, pageClamped, PAGE_SIZE);

  return (
    <div className={s.classPanel}>
      {assignments.length === 0 ? (
        <Blank art="reading" title="Lớp chưa có bài tập riêng">
          Khi ra đề, chọn lớp này để chỉ học viên trong lớp mới thấy đề.
        </Blank>
      ) : (
        <>
          <div className={s.classPanelFilters}>
            <input
              className={s.field}
              style={{ maxWidth: "16rem" }}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo tiêu đề"
            />
            <label className={s.paperFilterField}>
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
          </div>

          {rows.length === 0 ? (
            <p className={s.fieldHint}>Không khớp bài tập nào.</p>
          ) : (
            <div className={s.miniGrid}>
              {rows.map((a) => (
                <Link
                  key={a.id}
                  href={`/teacher/assignments/${a.id}`}
                  className={`${s.miniCard} ${s.miniCardLink}`}
                >
                  <span className={s.miniCardName}>{a.title}</span>
                  <span className={s.miniCardMeta}>
                    {TASK_TYPE_LABEL[a.taskType]} · {ASSIGNMENT_STATUS_LABEL[a.status]}
                    <br />
                    hạn {day(a.dueAt)}
                  </span>
                  <span className={s.miniCardGo}>Xem chi tiết →</span>
                </Link>
              ))}
            </div>
          )}

          <Pager page={pageClamped} totalPages={totalPages} onPage={setPage} />
        </>
      )}
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
  onRevoke: (id: string) => void;
  inviteLabel: string;
  onInviteLabelChange: (v: string) => void;
  onCreate: () => void;
  newLinkUrl: string | null;
  origin: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [qrByLink, setQrByLink] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter(
      (l) => (l.label ?? "").toLowerCase().includes(q) || l.token.toLowerCase().includes(q),
    );
  }, [links, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const rows = paginate(filtered, pageClamped, PAGE_SIZE);
  const rowIds = rows.map((r) => r.id).join(",");

  useEffect(() => {
    let cancelled = false;
    rows.forEach((link) => {
      if (qrByLink[link.id]) return;
      const url = `${origin}/join/${link.token}`;
      toDataURL(url, { margin: 1, width: 160 })
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
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const copyLink = async (link: InviteLinkRow) => {
    const url = `${origin}/join/${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      flash(`${link.id}:link`);
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

  return (
    <div className={s.classPanel}>
      <div className={s.actionRow} style={{ marginTop: 0 }} data-tour="invite-link">
        <input
          className={s.field}
          style={{ flex: "1 1 14rem" }}
          value={inviteLabel}
          onChange={(e) => onInviteLabelChange(e.target.value)}
          placeholder="Nhãn liên kết (tùy chọn)"
        />
        <button type="button" className={s.press} disabled={busy} onClick={onCreate}>
          Tạo liên kết mời
        </button>
      </div>
      {newLinkUrl ? (
        <Notice tone="ok">
          Đã tạo: <span className={s.figure}>{newLinkUrl}</span> — gửi cho học viên để họ tự vào lớp.
        </Notice>
      ) : null}

      {links.length === 0 ? (
        <Blank art="reading" title="Chưa có liên kết mời nào">
          Tạo liên kết ở trên để học viên tự vào lớp.
        </Blank>
      ) : (
        <>
          <div className={s.classPanelFilters}>
            <input
              className={s.field}
              style={{ maxWidth: "18rem" }}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo nhãn"
            />
          </div>

          {rows.length === 0 ? (
            <p className={s.fieldHint}>Không khớp liên kết nào.</p>
          ) : (
            <div className={s.miniGrid}>
              {rows.map((link) => {
                const url = `${origin}/join/${link.token}`;
                return (
                  <div key={link.id} className={s.miniCard}>
                    <div style={{ display: "flex", gap: "0.7rem" }}>
                      {qrByLink[link.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrByLink[link.id]} alt="Mã QR liên kết mời" className={s.qrThumb} />
                      ) : (
                        <span className={s.qrThumb} aria-hidden="true" />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <span className={s.miniCardName}>{link.label || "Liên kết mời"}</span>
                        <span className={s.miniCardMeta}>
                          {url}
                          <br />
                          đã dùng {link.useCount}
                          {link.maxUses ? `/${link.maxUses}` : ""} lần
                        </span>
                      </div>
                    </div>
                    <div className={s.miniCardActions}>
                      <button type="button" className={s.pressQuiet} onClick={() => copyLink(link)}>
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
                      <button type="button" className={s.pressQuiet} disabled={busy} onClick={() => onRevoke(link.id)}>
                        Xóa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Pager page={pageClamped} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
