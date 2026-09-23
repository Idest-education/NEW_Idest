import type { Metadata } from "next";
import Link from "next/link";
import { Shell, board as s } from "../../../components/board";
import { AttemptBars, LatencySeries } from "../../../components/admin-charts";
import { fetchScoringHealth } from "../../../lib/analytics";
import { requireAdmin } from "../require-admin";
import styles from "../admin.module.css";

export const metadata: Metadata = {
  title: "Sức khỏe luồng chấm — Idest AI",
};

/**
 * `searchParams` is a Promise in this version of Next.js and must be awaited.
 * Reading it also opts the route into request-time rendering, which is what we
 * want: this page must never be prerendered with one admin's data.
 */
export default async function AdminScoringPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { token } = await requireAdmin();
  const { from, to } = await searchParams;
  const rows = await fetchScoringHealth(token, { from, to });

  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const failures = rows.reduce((sum, row) => sum + row.failures, 0);
  const retries = rows.reduce((sum, row) => sum + row.retries, 0);
  const models = Array.from(
    new Set(rows.map((row) => `${row.modelName} ${row.modelVersion}`)),
  );

  return (
    <Shell role="admin" wide>
      <h1 className={s.title}>Sức khỏe luồng chấm</h1>
      <p className={s.subtitle}>
        {attempts} lượt AI chấm, {failures} lượt lỗi, {retries} lượt chấm lại
        {from || to ? ` trong khoảng ${from ?? "…"} → ${to ?? "…"}` : ""}.
      </p>

      {rows.length === 0 ? (
        <p className={styles.caveat}>
          Chưa có lượt chấm nào trong khoảng này. Thêm <code>?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code>{" "}
          vào địa chỉ để đổi khoảng thời gian.
        </p>
      ) : (
        <>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Độ trễ theo ngày</h2>
            <Link href="/admin" className={s.navLink}>
              ← Tổng quan
            </Link>
          </div>
          <LatencySeries rows={rows} />

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Lượt chấm theo ngày</h2>
          </div>
          <AttemptBars rows={rows} />

          <p className={styles.caveat}>
            Các mốc được gom theo ngày UTC và tách theo phiên bản mô hình:{" "}
            {models.join(", ")}. Nhãn <code>pre_provenance</code> là các kết quả AI được ghi
            trước khi worker gửi kèm mô tả mô hình; chúng không thể gán lại phiên bản và bị loại
            khỏi phần so sánh giữa các mô hình.
          </p>
        </>
      )}
    </Shell>
  );
}
