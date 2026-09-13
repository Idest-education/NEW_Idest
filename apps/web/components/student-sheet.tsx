"use client";

import { useMemo } from "react";
import {
  CRITERIA,
  CRITERION_LABEL,
  STUDENT_STATE_LABEL,
  TASK_TYPE_LABEL,
  type SubmissionStudent,
} from "../lib/idest";
import { band, day, splitParagraphs, stamp, stripRef } from "../lib/format";
import { Blank, CriterionRow, Notice, board as s } from "./board";

/** The student's own strip: their essay, and the signed sheet once it exists. */
export function StudentSheet({ submission }: { submission: SubmissionStudent }) {
  const paragraphs = useMemo(
    () => splitParagraphs(submission.essayText),
    [submission.essayText],
  );
  const published = submission.publishedResult;

  return (
    <>
      <div className={s.slugLine}>
        <span className={s.slugRef}>{stripRef(submission.id, submission.attemptNumber)}</span>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          {submission.assignment.title}
        </h1>
        <span className={s.slugMeta}>
          <span>{TASK_TYPE_LABEL[submission.assignment.taskType]}</span>
          <span>lần {submission.attemptNumber}</span>
          <span>{submission.wordCount} từ</span>
          <span>nộp {stamp(submission.submittedAt)}</span>
          <span>{STUDENT_STATE_LABEL[submission.status]}</span>
        </span>
      </div>

      <div className={s.sheet}>
        <div>
          <p className={s.prompt}>{submission.assignment.taskPrompt}</p>
          <article className={s.essaySheet}>
            <div className={s.essay}>
              {paragraphs.map((paragraph, index) => (
                <div key={index} className={s.essayPara}>
                  <span className={s.essayNum}>{String(index + 1).padStart(2, "0")}</span>
                  <p>{paragraph}</p>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className={s.rail}>
          {published ? (
            <>
              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Điểm tổng</span>
                  <span className={s.stamp}>Giáo viên đã duyệt</span>
                </header>
                <div className={s.overall}>
                  <span className={s.overallFigure}>{band(published.finalScores.overall)}</span>
                  <span className={s.overallSide}>
                    <span className={s.overallCaption}>duyệt {stamp(published.publishedAt)}</span>
                  </span>
                </div>
              </section>

              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Bốn tiêu chí</span>
                </header>
                {CRITERIA.map((criterion) => (
                  <CriterionRow
                    key={criterion}
                    criterion={criterion}
                    name={CRITERION_LABEL[criterion]}
                    machine={undefined}
                    value={published.finalScores[criterion]}
                  />
                ))}
              </section>

              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Giáo viên nhận xét</span>
                </header>
                <p>{published.finalFeedback.summary ?? "—"}</p>
                {published.finalFeedback.improvements?.length ? (
                  <div className={s.noteList}>
                    <span className={s.label}>Nên sửa</span>
                    {published.finalFeedback.improvements.map((item, index) => (
                      <span key={index} className={s.noteItem}>
                        <span className={s.noteBullet}>{String(index + 1).padStart(2, "0")}</span>
                        <span>{item}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {published.finalFeedback.strengths?.length ? (
                  <div className={s.noteList}>
                    <span className={s.label}>Làm tốt</span>
                    {published.finalFeedback.strengths.map((item, index) => (
                      <span key={index} className={s.noteItem}>
                        <span className={s.noteBullet}>{String(index + 1).padStart(2, "0")}</span>
                        <span>{item}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : submission.redoRequest ? (
            <section className={s.railBlock}>
              <Notice tone="alert">
                Giáo viên yêu cầu bạn làm lại bài này: {submission.redoRequest.reason}
              </Notice>
              <p className={s.fieldHint}>
                Yêu cầu lúc {stamp(submission.redoRequest.createdAt)} · hạn nộp{" "}
                {day(submission.assignment.dueAt)}
              </p>
              <a href={`/student/assignments/${submission.assignment.id}`} className={s.press}>
                Viết lại bài
              </a>
            </section>
          ) : (
            <section className={s.railBlock}>
              {submission.status === "failed" ? (
                <Blank art="listening" title="Bài của bạn đang chờ xử lý">
                  Bài viết của bạn đã được lưu đầy đủ và giáo viên đã thấy nó trên bảng. Lần chấm
                  vừa rồi gặp lỗi kỹ thuật nên kết quả đến chậm hơn bình thường. Bạn không cần nộp
                  lại.
                </Blank>
              ) : (
                <Blank art="listening" title="Giáo viên đang chấm bài này">
                  Bài của bạn đã nằm trong hàng chờ của giáo viên. Kết quả chỉ hiện ở đây sau khi
                  giáo viên duyệt — trang này tự cập nhật, bạn không cần nộp lại.
                </Blank>
              )}
              <p className={s.fieldHint}>Nộp lúc {stamp(submission.submittedAt)}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
