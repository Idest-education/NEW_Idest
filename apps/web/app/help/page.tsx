"use client";

import { type FormEvent, useState } from "react";
import { getProfile, submitTicket, type Profile } from "../../lib/idest";
import { useAction, useResource } from "../../lib/use-api";
import { Notice, Shell, board as s } from "../../components/board";

const GUIDE_SECTIONS: { label: string; page: number }[] = [
  { label: "1. Giới thiệu", page: 1 },
  { label: "2. Tạo tài khoản", page: 4 },
  { label: "3. Đăng nhập", page: 6 },
  { label: "4. Quản lý lớp", page: 12 },
  { label: "5. Mời học viên", page: 17 },
  { label: "6. Quản lý bài tập", page: 22 },
  { label: "7. Học viên nộp bài", page: 30 },
  { label: "8. Chấm bài", page: 33 },
  { label: "9. Sau khi duyệt", page: 44 },
  { label: "10. Hồ sơ cá nhân và xóa tài khoản", page: 47 },
  { label: "11. Câu hỏi thường gặp", page: 48 },
];

export default function HelpPage() {
  const { data } = useResource<Profile>((token) => getProfile(token));

  return (
    <Shell role={data?.role}>
      <h1 className={s.title}>Trợ giúp</h1>
      <p className={s.subtitle}>Gặp trục trặc hoặc có câu hỏi? Gửi yêu cầu bên dưới, hoặc mở hướng dẫn sử dụng.</p>

      <TicketForm />

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Hướng dẫn sử dụng</h2>
      </div>
      <div className={s.railBlock}>
        <ul>
          {GUIDE_SECTIONS.map((section) => (
            <li key={section.page}>
              <a href={`/huong-dan-su-dung.pdf#page=${section.page}`} target="_blank" rel="noreferrer">
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

function TicketForm() {
  const { busy, error, run } = useAction();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  // submitTicket resolves void on success, so run(...)'s return value can't
  // tell success apart from the caught-and-swallowed failure case (both are
  // undefined) — track success with this flag instead, set only when the
  // call inside run() does not throw.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSent(false);
    let ok = true;
    await run(async (token) => {
      try {
        await submitTicket(token, subject.trim(), message.trim());
      } catch (err) {
        ok = false;
        throw err;
      }
    });
    if (ok) {
      setSubject("");
      setMessage("");
      setSent(true);
    }
  };

  return (
    <form className={s.railBlock} onSubmit={submit}>
      <label className={s.fieldLabel} htmlFor="ticket-subject">
        Tiêu đề
      </label>
      <input
        id="ticket-subject"
        className={s.field}
        value={subject}
        onChange={(e) => {
          setSubject(e.target.value);
          setSent(false);
        }}
        placeholder="Ví dụ: Không nộp được bài"
      />

      <div className={s.fieldRow}>
        <label className={s.fieldLabel} htmlFor="ticket-message">
          Mô tả
        </label>
        <textarea
          id="ticket-message"
          className={s.field}
          rows={6}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setSent(false);
          }}
          placeholder="Mô tả chi tiết vấn đề bạn gặp phải..."
        />
      </div>

      <div className={s.actionRow}>
        <button type="submit" className={s.press} disabled={busy || !subject.trim() || !message.trim()}>
          {busy ? "Đang gửi…" : "Gửi yêu cầu"}
        </button>
      </div>
      {sent ? <Notice tone="ok">Đã gửi yêu cầu. Cảm ơn bạn!</Notice> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </form>
  );
}
