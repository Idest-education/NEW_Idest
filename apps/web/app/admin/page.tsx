import type { Metadata } from "next";
import Link from "next/link";
import { Shell, board as s } from "../../components/board";
import { DeltaBars, HeadlineCards } from "../../components/admin-charts";
import { FeedbackExport } from "../../components/feedback-export";
import { fetchOverview } from "../../lib/analytics";
import { requireAdmin } from "./require-admin";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Phân tích — Idest AI",
};

export default async function AdminOverviewPage() {
  const { token } = await requireAdmin();
  const overview = await fetchOverview(token);

  return (
    <Shell role="admin" wide>
      <h1 className={s.title}>Phân tích đánh giá</h1>
      <p className={s.subtitle}>
        Mức đồng thuận giữa AI và giáo viên, hành vi sửa điểm, và sức khỏe của luồng chấm.
      </p>

      <HeadlineCards overview={overview} />

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Lệch tuyệt đối trung bình theo tiêu chí</h2>
        <Link href="/admin/scoring" className={s.navLink}>
          Sức khỏe luồng chấm →
        </Link>
      </div>
      <DeltaBars overview={overview} />

      <p className={styles.caveat}>
        Chỉ tính trên {overview.agreement.rowsWithAiBaseline} bài có điểm AI để đối chiếu. Bài
        giáo viên chấm trước khi AI kịp chấm — hoặc sau khi AI lỗi — không có điểm nền để so và
        bị loại khỏi mọi chỉ số đồng thuận. Với các bài còn lại, giáo viên đã nhìn thấy điểm AI
        trước khi nhập điểm của mình, nên đây là mức đồng thuận có neo (anchoring), không phải
        đồng thuận độc lập.
      </p>

      <FeedbackExport />
    </Shell>
  );
}
