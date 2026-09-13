"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABEL,
  CLASS_STATUS_LABEL,
  type ClassDetail,
  addClassMember,
  createInviteLink,
  deleteClass,
  getClass,
  removeClassMember,
  revokeInviteLink,
  updateClass,
} from "../../../../lib/idest";
import { day, stamp } from "../../../../lib/format";
import { useAction, useResource } from "../../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../../components/board";

export default function ClassDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
      {state === "ready" && data ? <ClassBody klass={data} onChanged={reload} /> : null}
    </Shell>
  );
}

function ClassBody({ klass, onChanged }: { klass: ClassDetail; onChanged: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(klass.name);
  const [description, setDescription] = useState(klass.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);

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
    if (!memberEmail.trim()) {
      setMemberError("Nhập email học viên đã có tài khoản.");
      return;
    }
    setMemberError(null);
    const done = await run((token) => addClassMember(token, klass.id, memberEmail.trim()));
    if (done) {
      setMemberEmail("");
      await onChanged();
    }
  }, [klass.id, memberEmail, run, onChanged]);

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

  return (
    <>
      <div className={s.slugLine}>
        <span className={s.slugRef}>{CLASS_STATUS_LABEL[klass.status]}</span>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          {klass.name}
        </h1>
        <span className={s.slugMeta}>
          <span>{activeMembers.length} học viên</span>
          <span>{klass.assignments.length} bài tập</span>
        </span>
      </div>

      {klass.description ? <p className={s.prompt}>{klass.description}</p> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}

      <div className={s.actionRow}>
        <button type="button" className={s.pressQuiet} onClick={() => setEditing((v) => !v)}>
          {editing ? "Đóng sửa" : "Sửa tên/mô tả"}
        </button>
        <button type="button" className={s.pressQuiet} disabled={busy} onClick={toggleArchive}>
          {klass.status === "active" ? "Lưu trữ lớp" : "Mở lại lớp"}
        </button>
        {confirmDelete ? (
          <>
            <span className={s.fieldHint}>Xóa hẳn lớp này? Bài tập phải đóng hết trước.</span>
            <button type="button" className={s.pressQuiet} disabled={busy} onClick={remove}>
              Xác nhận xóa
            </button>
            <button type="button" className={s.pressQuiet} onClick={() => setConfirmDelete(false)}>
              Thôi
            </button>
          </>
        ) : (
          <button type="button" className={s.pressQuiet} onClick={() => setConfirmDelete(true)}>
            Xóa lớp
          </button>
        )}
        <Link href="/teacher/classes" className={s.navLink}>
          ← Tất cả lớp
        </Link>
      </div>

      {editing ? (
        <div className={s.railBlock}>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel} htmlFor="cn">
              Tên lớp
            </label>
            <input id="cn" className={s.field} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel} htmlFor="cd">
              Mô tả
            </label>
            <textarea id="cd" className={s.field} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className={s.actionRow}>
            <button type="button" className={s.press} disabled={busy} onClick={saveEdit}>
              Lưu
            </button>
          </div>
        </div>
      ) : null}

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Học viên trong lớp</h2>
      </div>
      <div className={s.railBlock}>
        {activeMembers.length === 0 ? (
          <p className={s.fieldHint}>Chưa có học viên. Thêm bằng email hoặc gửi liên kết mời bên dưới.</p>
        ) : (
          activeMembers.map((m) => (
            <div key={m.id} className={s.rosterRow}>
              <span className={s.rosterName}>
                {m.student.displayName}
                <span className={s.rosterMeta} style={{ display: "block" }}>
                  {m.student.email} · vào lớp {day(m.joinedAt)}
                </span>
              </span>
              <button
                type="button"
                className={s.pressQuiet}
                disabled={busy}
                onClick={() => removeMember(m.student.id)}
              >
                Xóa khỏi lớp
              </button>
            </div>
          ))
        )}

        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor="add-member">
            Thêm học viên bằng email (đã có tài khoản)
          </label>
          <div className={s.actionRow} style={{ marginTop: 0 }}>
            <input
              id="add-member"
              className={s.field}
              style={{ flex: "1 1 16rem" }}
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="hocvien@example.com"
            />
            <button type="button" className={s.pressQuiet} disabled={busy} onClick={addMember}>
              Thêm
            </button>
          </div>
          {memberError ? <Notice tone="alert">{memberError}</Notice> : null}
        </div>
      </div>

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Liên kết mời vào lớp</h2>
      </div>
      <div className={s.railBlock}>
        {klass.inviteLinks.length === 0 ? (
          <p className={s.fieldHint}>Chưa có liên kết nào đang mở.</p>
        ) : (
          klass.inviteLinks.map((link) => (
            <div key={link.id} className={s.rosterRow}>
              <span className={s.rosterName}>
                {link.label || "Liên kết mời"}
                <span className={s.rosterMeta} style={{ display: "block" }}>
                  {origin}/join/{link.token} · đã dùng {link.useCount}
                  {link.maxUses ? `/${link.maxUses}` : ""} lần
                </span>
              </span>
              <button type="button" className={s.pressQuiet} disabled={busy} onClick={() => revokeLink(link.id)}>
                Thu hồi
              </button>
            </div>
          ))
        )}

        <div className={s.actionRow}>
          <input
            className={s.field}
            style={{ flex: "1 1 14rem" }}
            value={inviteLabel}
            onChange={(e) => setInviteLabel(e.target.value)}
            placeholder="Nhãn liên kết (tùy chọn)"
          />
          <button type="button" className={s.press} disabled={busy} onClick={makeInviteLink}>
            Tạo liên kết mời
          </button>
        </div>
        {newLinkUrl ? (
          <Notice tone="ok">
            Đã tạo: <span className={s.figure}>{newLinkUrl}</span> — gửi cho học viên để họ tự vào lớp.
          </Notice>
        ) : null}
      </div>

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Bài tập của lớp</h2>
      </div>
      {klass.assignments.length === 0 ? (
        <Blank art="reading" title="Lớp chưa có bài tập riêng">
          Khi ra đề, chọn lớp này để chỉ học viên trong lớp mới thấy đề.
        </Blank>
      ) : (
        <div className={s.rack}>
          {klass.assignments.map((a) => (
            <Link key={a.id} href={`/teacher/assignments/${a.id}`} className={s.strip}>
              <span className={s.stripRef}>{a.taskType}</span>
              <span className={s.stripBody}>
                <span className={s.stripName}>{a.title}</span>
                <span className={s.stripMeta}>
                  <span>{ASSIGNMENT_STATUS_LABEL[a.status]}</span>
                  <span>hạn {day(a.dueAt)}</span>
                </span>
              </span>
              <span className={s.stripEnd}>
                <span className={s.stripState}>Xem</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
