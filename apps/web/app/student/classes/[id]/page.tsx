"use client";

import { use } from "react";
import Link from "next/link";
import { ASSIGNMENT_STATUS_LABEL, type ClassDetail, getClass } from "../../../../lib/idest";
import { day } from "../../../../lib/format";
import { useResource } from "../../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../../components/board";

export default function StudentClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, state, error } = useResource<ClassDetail>((token) => getClass(token, id), [id]);

  return (
    <Shell role="student">
      {state === "loading" ? <WaitingRack /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href="/student/classes" className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về danh sách lớp
          </Link>
        </>
      ) : null}

      {state === "ready" && data ? (
        <>
          <div className={s.slugLine}>
            <h1 className={s.title} style={{ marginRight: "auto" }}>
              {data.name}
            </h1>
            <span className={s.slugMeta}>
              <span>{data.members.length} học viên</span>
              <span>{data.assignments.length} bài tập</span>
            </span>
          </div>
          {data.description ? <p className={s.prompt}>{data.description}</p> : null}

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Bạn cùng lớp</h2>
          </div>
          <div className={s.railBlock}>
            {data.members.map((m) => (
              <div key={m.id} className={s.rosterRow}>
                <span className={s.rosterName}>{m.student.displayName}</span>
              </div>
            ))}
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Bài tập của lớp</h2>
            <Link href="/student" className={s.navLink}>
              ← Bài viết của bạn
            </Link>
          </div>
          {data.assignments.length === 0 ? (
            <Blank art="reading" title="Lớp chưa có bài tập riêng">
              Bài tập chung cho tất cả học viên vẫn hiện ở trang chính.
            </Blank>
          ) : (
            <div className={s.rack}>
              {data.assignments.map((a) => (
                <Link key={a.id} href={`/student/assignments/${a.id}`} className={s.strip}>
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
      ) : null}
    </Shell>
  );
}
