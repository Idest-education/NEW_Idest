"use client";

import { downloadFeedbackExport, type FeedbackExportFormat } from "../lib/idest";
import { exportFilename } from "../lib/feedback";
import { useAction } from "../lib/use-api";
import { Notice, board as s } from "./board";

/** The admin page is a server component; downloads need the Clerk token here. */
export function FeedbackExport() {
  const { busy, error, run } = useAction();

  const download = async (format: FeedbackExportFormat) => {
    const blob = await run((token) => downloadFeedbackExport(token, format));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(format);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="feedback-export-title">
      <div className={s.sectionHead}>
        <h2 id="feedback-export-title" className={s.sectionTitle}>
          Khảo sát góp ý
        </h2>
      </div>
      <div className={s.actionRow}>
        <button type="button" className={s.press} disabled={busy} onClick={() => void download("csv")}>
          Tải CSV
        </button>
        <button type="button" className={s.pressQuiet} disabled={busy} onClick={() => void download("sps")}>
          Tải cú pháp SPSS (.sps)
        </button>
      </div>
      <p className={s.fieldHint}>Đặt hai tệp cùng một thư mục rồi chạy tệp .sps trong SPSS.</p>
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </section>
  );
}
