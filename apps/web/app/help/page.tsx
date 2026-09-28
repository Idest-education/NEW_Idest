"use client";

import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from "react";
import {
  getProfile,
  listTickets,
  submitTicket,
  type Profile,
  type SupportTicket,
} from "../../lib/idest";
import { day, fileSize, stamp } from "../../lib/format";
import { useAction, useResource } from "../../lib/use-api";
import { Notice, Shell, board as s } from "../../components/board";
import { OnboardingReplay } from "../../components/onboarding-card";
import h from "./help.module.css";

const GUIDE_PDF = "/huong-dan-su-dung.pdf";

type Audience = "Mọi người" | "Giáo viên" | "Học viên";

const GUIDE_SECTIONS: { label: string; summary: string; page: number; audience: Audience }[] = [
  {
    label: "Giới thiệu",
    summary: "Idest là gì, AI và giáo viên chia việc chấm bài ra sao.",
    page: 1,
    audience: "Mọi người",
  },
  {
    label: "Tạo tài khoản",
    summary: "Giáo viên tự đăng ký; học viên vào qua liên kết mời hoặc email.",
    page: 4,
    audience: "Mọi người",
  },
  {
    label: "Đăng nhập",
    summary: "Trang đăng nhập và màn hình đầu tiên của từng vai trò.",
    page: 6,
    audience: "Mọi người",
  },
  {
    label: "Quản lý lớp",
    summary: "Tạo lớp, sửa thông tin, lưu trữ, thêm học viên bằng email.",
    page: 12,
    audience: "Giáo viên",
  },
  {
    label: "Mời học viên",
    summary: "Tạo và chia sẻ liên kết mời, hoặc mời từng người qua email.",
    page: 17,
    audience: "Giáo viên",
  },
  {
    label: "Quản lý bài tập",
    summary: "Tạo, mở, ghim, sửa, đóng bài tập và xem danh sách bài nộp.",
    page: 22,
    audience: "Giáo viên",
  },
  {
    label: "Học viên nộp bài",
    summary: "Viết bài, đếm từ, lưu nháp tự động và những gì xảy ra sau khi nộp.",
    page: 30,
    audience: "Học viên",
  },
  {
    label: "Chấm bài",
    summary: "Đọc đánh giá của AI, sửa điểm bốn tiêu chí, nhận xét và duyệt.",
    page: 33,
    audience: "Giáo viên",
  },
  {
    label: "Sau khi duyệt",
    summary: "Học viên xem kết quả; giáo viên mở lại hoặc yêu cầu làm lại.",
    page: 44,
    audience: "Mọi người",
  },
  {
    label: "Hồ sơ cá nhân và xóa tài khoản",
    summary: "Đổi tên hiển thị và đóng tài khoản vĩnh viễn.",
    page: 47,
    audience: "Mọi người",
  },
  {
    label: "Câu hỏi thường gặp",
    summary: "Giải đáp nhanh các tình huống hay gặp khi dùng Idest.",
    page: 48,
    audience: "Mọi người",
  },
];

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export default function HelpPage() {
  const { data } = useResource<Profile>((token) => getProfile(token));
  const tickets = useResource<SupportTicket[]>((token) => listTickets(token));
  const isAdmin = data?.role === "admin";

  return (
    <Shell role={data?.role}>
      <h1 className={s.title}>Trợ giúp</h1>
      <p className={s.subtitle}>
        Gặp trục trặc hoặc có câu hỏi? Gửi yêu cầu cho đội Idest và theo dõi tiến độ ngay bên cạnh, hoặc tra
        cứu hướng dẫn sử dụng bên dưới.
      </p>

      <div className={h.supportGrid}>
        <section aria-labelledby="ticket-form-title">
          <div className={h.panelHead}>
            <h2 id="ticket-form-title" className={s.sectionTitle}>
              Gửi yêu cầu mới
            </h2>
          </div>
          <TicketForm onSent={() => void tickets.reload()} />
        </section>

        <section aria-labelledby="ticket-list-title">
          <div className={h.panelHead}>
            <h2 id="ticket-list-title" className={s.sectionTitle}>
              {isAdmin ? "Tất cả yêu cầu" : "Yêu cầu đã tiếp nhận"}
              {tickets.data ? <span className={h.count}>{tickets.data.length}</span> : null}
            </h2>
            <button
              type="button"
              className={h.linkButton}
              onClick={() => void tickets.reload()}
              disabled={tickets.state === "loading"}
            >
              Làm mới
            </button>
          </div>
          <TicketList
            tickets={tickets.data}
            state={tickets.state}
            error={tickets.error}
            showReporter={isAdmin}
          />
        </section>
      </div>

      {data?.role === "teacher" ? <OnboardingReplay /> : null}

      <GuideSection />
    </Shell>
  );
}

interface StagedImage {
  file: File;
  url: string;
}

function TicketForm({ onSent }: { onSent: () => void }) {
  const { busy, error, run } = useAction();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sent, setSent] = useState<{ failed: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Object URLs pin their blobs in memory until revoked.
  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  const addFiles = (files: Iterable<File>) => {
    setSent(null);
    const accepted: StagedImage[] = [];
    let problem: string | null = null;
    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        problem = `"${file.name}" không phải ảnh PNG, JPG, WEBP, GIF hoặc HEIC.`;
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        problem = `"${file.name}" lớn hơn 5MB.`;
        continue;
      }
      if (images.length + accepted.length >= MAX_IMAGES) {
        problem = `Chỉ đính kèm được tối đa ${MAX_IMAGES} ảnh.`;
        break;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    setImageError(problem);
    if (accepted.length) setImages((current) => [...current, ...accepted]);
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((_, i) => i !== index);
    });
    setImageError(null);
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  // submitTicket's result can't tell success apart from run()'s
  // caught-and-swallowed failure (both may be undefined) — track success
  // with this flag instead, set only when the call inside run() does not throw.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSent(null);
    let ok = true;
    let failed = 0;
    await run(async (token) => {
      try {
        const created = await submitTicket(
          token,
          subject.trim(),
          message.trim(),
          images.map((image) => image.file),
        );
        failed = created?.attachmentsFailed ?? 0;
      } catch (err) {
        ok = false;
        throw err;
      }
    });
    if (ok) {
      images.forEach((image) => URL.revokeObjectURL(image.url));
      setSubject("");
      setMessage("");
      setImages([]);
      setImageError(null);
      setSent({ failed });
      onSent();
    }
  };

  const full = images.length >= MAX_IMAGES;

  return (
    <form className={`${s.railBlock} ${h.formPanel}`} onSubmit={submit} onPaste={onPaste}>
      <label className={s.fieldLabel} htmlFor="ticket-subject">
        Tiêu đề
      </label>
      <input
        id="ticket-subject"
        className={s.field}
        value={subject}
        onChange={(e) => {
          setSubject(e.target.value);
          setSent(null);
        }}
        placeholder="Ví dụ: Không nộp được bài"
        maxLength={200}
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
            setSent(null);
          }}
          placeholder="Mô tả chi tiết vấn đề bạn gặp phải: bạn đang làm gì, bấm vào đâu, trang hiện gì…"
          maxLength={5000}
        />
        <p className={s.fieldHint}>{message.length}/5000</p>
      </div>

      <div className={s.fieldRow}>
        <span className={s.fieldLabel} id="ticket-images-label">
          Ảnh chụp màn hình (không bắt buộc)
        </span>
        <div
          className={`${h.attachZone} ${dragging ? h.attachZoneActive : ""} ${full ? h.attachZoneFull : ""}`}
          role="button"
          tabIndex={full || busy ? -1 : 0}
          aria-labelledby="ticket-images-label"
          aria-disabled={full || busy}
          onClick={() => !full && !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !full && !busy) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            if (full || busy) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (full || busy) return;
            e.preventDefault();
            setDragging(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <span className={h.attachIcon} aria-hidden="true">
            +
          </span>
          <span>
            {full ? (
              `Đã đủ ${MAX_IMAGES} ảnh`
            ) : (
              <>
                <strong>Chọn ảnh</strong>, kéo thả, hoặc dán (Ctrl+V) vào biểu mẫu
              </>
            )}
            <span className={h.attachHint}>
              Tối đa {MAX_IMAGES} ảnh · 5MB mỗi ảnh · PNG, JPG, WEBP, GIF, HEIC
            </span>
          </span>
        </div>

        {images.length > 0 ? (
          <ul className={h.thumbs}>
            {images.map((image, index) => (
              <li key={image.url} className={h.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className={h.thumbImg} />
                <span className={h.thumbMeta}>
                  <span className={h.thumbName}>{image.file.name}</span>
                  <span className={h.thumbSize}>{fileSize(image.file.size)}</span>
                </span>
                <button
                  type="button"
                  className={h.thumbRemove}
                  onClick={() => removeImage(index)}
                  disabled={busy}
                  aria-label={`Bỏ ảnh ${image.file.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {imageError ? <p className={h.attachError}>{imageError}</p> : null}
      </div>

      <div className={s.actionRow}>
        <button type="submit" className={s.press} disabled={busy || !subject.trim() || !message.trim()}>
          {busy ? "Đang gửi…" : "Gửi yêu cầu"}
        </button>
      </div>
      {sent && sent.failed === 0 ? <Notice tone="ok">Đã gửi yêu cầu. Cảm ơn bạn!</Notice> : null}
      {sent && sent.failed > 0 ? (
        <Notice tone="alert">
          Đã gửi yêu cầu, nhưng {sent.failed} ảnh không tải lên được. Bạn có thể gửi thêm một yêu cầu kèm ảnh đó.
        </Notice>
      ) : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </form>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: "Đã tiếp nhận",
  custom: "Đang xử lý",
  done: "Đã xử lý",
  closed: "Đã đóng",
};

function statusLabel(ticket: SupportTicket): string {
  return (ticket.statusType && STATUS_LABEL[ticket.statusType]) ?? ticket.status;
}

function TicketList({
  tickets,
  state,
  error,
  showReporter,
}: {
  tickets: SupportTicket[] | null;
  state: "loading" | "ready" | "error";
  error: string | null;
  showReporter: boolean;
}) {
  if (state === "loading" && !tickets) {
    return (
      <div className={h.listPanel} aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={h.ticketSkeleton} />
        ))}
      </div>
    );
  }

  if (state === "error" && !tickets) {
    return (
      <div className={h.listPanel}>
        <Notice tone="alert">{error}</Notice>
      </div>
    );
  }

  if (!tickets || tickets.length === 0) {
    return (
      <div className={`${h.listPanel} ${h.listEmpty}`}>
        <p className={h.emptyTitle}>Chưa có yêu cầu nào</p>
        <p className={h.emptyText}>Các yêu cầu gửi tới đội Idest sẽ hiện ở đây cùng trạng thái xử lý.</p>
      </div>
    );
  }

  return (
    <div className={h.listPanel}>
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <ul className={h.ticketList}>
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <details className={h.ticket}>
              <summary className={h.ticketSummary}>
                <span className={h.ticketTop}>
                  <span
                    className={h.status}
                    style={ticket.statusColor ? { ["--status" as string]: ticket.statusColor } : undefined}
                  >
                    {statusLabel(ticket)}
                  </span>
                  <time className={h.ticketDate} dateTime={ticket.createdAt} title={stamp(ticket.createdAt)}>
                    {day(ticket.createdAt)}
                  </time>
                </span>
                <span className={h.ticketSubject}>{ticket.subject}</span>
                {showReporter && ticket.reporter ? (
                  <span className={h.ticketReporter}>{ticket.reporter}</span>
                ) : null}
              </summary>
              <p className={h.ticketMessage}>{ticket.message || "—"}</p>
              <p className={h.ticketRef}>Mã yêu cầu: {ticket.id}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuideSection() {
  return (
    <section aria-labelledby="guide-title" className={h.guide}>
      <div className={h.guideHead}>
        <div>
          <h2 id="guide-title" className={h.guideTitle}>
            Hướng dẫn sử dụng
          </h2>
          <p className={h.guideLead}>
            Tài liệu đầy đủ cho giáo viên và học viên, 11 chương, kèm ảnh chụp màn hình từng bước. Bấm một chương
            để mở tài liệu PDF đúng trang đó.
          </p>
        </div>
        <a className={s.pressQuiet} href={GUIDE_PDF} target="_blank" rel="noreferrer">
          Mở toàn bộ tài liệu (PDF)
        </a>
      </div>

      <ol className={h.chapters}>
        {GUIDE_SECTIONS.map((section, index) => (
          <li key={section.page}>
            <a
              className={h.chapter}
              href={`${GUIDE_PDF}#page=${section.page}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className={h.chapterNo}>{String(index + 1).padStart(2, "0")}</span>
              <span className={h.chapterBody}>
                <span className={h.chapterTitle}>{section.label}</span>
                <span className={h.chapterSummary}>{section.summary}</span>
                <span className={h.chapterMeta}>
                  <span className={h.audience}>{section.audience}</span>
                  <span>Trang {section.page}</span>
                </span>
              </span>
              <span className={h.chapterArrow} aria-hidden="true">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
