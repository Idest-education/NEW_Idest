"use client";

import Link from "next/link";
import { type ClassSummary, listClasses } from "../../../lib/idest";
import { useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../components/board";

export default function StudentClassesPage() {
  const { data, state, error } = useResource<ClassSummary[]>((token) => listClasses(token));

  return (
    <Shell role="student">
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Lớp của tôi
        </h1>
        <Link href="/student" className={s.navLink}>
          ← Bài viết của bạn
        </Link>
      </div>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        data.length === 0 ? (
          <Blank art="reading" title="Bạn chưa ở trong lớp nào">
            Giáo viên sẽ thêm bạn vào lớp, hoặc gửi cho bạn một liên kết mời.
          </Blank>
        ) : (
          <div className={s.rack} style={{ marginTop: "1.25rem" }}>
            {data.map((klass) => (
              <Link key={klass.id} href={`/student/classes/${klass.id}`} className={s.strip}>
                <span className={s.stripRef}>Lớp</span>
                <span className={s.stripBody}>
                  <span className={s.stripName}>{klass.name}</span>
                  <span className={s.stripMeta}>
                    <span>{klass.teacher?.displayName}</span>
                    <span>{klass.assignmentCount ?? 0} bài tập</span>
                  </span>
                </span>
                <span className={s.stripEnd}>
                  <span className={s.stripState}>Xem</span>
                </span>
              </Link>
            ))}
          </div>
        )
      ) : null}
    </Shell>
  );
}
