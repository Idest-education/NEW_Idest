import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Role } from "@repo/auth-contract";
import { Masthead } from "../components/masthead";
import board from "../components/board.module.css";
import styles from "./landing.module.css";
import { Reveal, RevealItem } from "../components/landing/reveal";
import { SpotlightCard } from "../components/landing/spotlight-card";
import { FlowDiagram } from "../components/landing/flow-diagram";

const BENEFITS = [
  {
    name: "AI chấm cái VÈOOOOO!",
    hint: "",
    text: "AI đọc và chấm nháp mỗi bài trong vài phút. Bạn chỉ cần sửa chỗ sai, thay vì chấm từ đầu.",
    accent: true,
  },
  {
    name: "Auto mà vẫn Âu-then-tíc!",
    hint: "Authentic",
    text: "AI không tự công bố điểm cho ai cả. Mọi kết quả học viên nhận được đều do chính bạn xem lại và duyệt.",
    accent: true,
  },
  {
    name: "AI chấm hay ai chấm?",
    hint: "",
    text: "Mỗi lần bạn sửa điểm đều được lưu lại, kèm chênh lệch so với AI — không gì bị ghi đè hay mất dấu.",
    accent: true,
  },
];

const STEPS = [
  {
    name: "Học viên nộp bài",
    text: "Viết thẳng trên trang, lưu nháp trên máy, rồi nộp. Hệ thống ghi lại bài tập, số từ và thời điểm nộp.",
  },
  {
    name: "AI chấm sơ bộ",
    text: "Mô hình ngôn ngữ chấm bốn tiêu chí IELTS và viết nhận xét trong vài phút — bản nháp của máy, chưa ai ngoài giáo viên nhìn thấy.",
  },
  {
    name: "Giáo viên sửa đè lên",
    text: "Đọc bài, sửa từng tiêu chí và viết lại nhận xét bằng chính giọng của mình. Điểm máy bị gạch nhưng vẫn nằm đó, không bị xóa.",
  },
  {
    name: "Giáo viên duyệt",
    text: "Trước khi duyệt, bạn thấy đúng bản mà học viên sẽ đọc. Duyệt xong học viên mới nhận kết quả.",
  },
];

const STUDENT_SEES = [
  "Điểm tổng và bốn tiêu chí do giáo viên xác nhận",
  "Nhận xét và gợi ý sửa bài của giáo viên",
  "Trạng thái bài nộp của chính mình",
  "Lịch sử các bài đã được duyệt",
];

const TEACHER_ONLY = [
  "Bản chấm sơ bộ của AI và mô hình đã dùng",
  "Từng lần sửa điểm, kèm chênh lệch so với AI",
  "Ghi chú nội bộ khi sửa",
  "Lần chấm lỗi của máy và trạng thái xử lý",
];

export default async function Landing() {
  const { userId, sessionClaims } = await auth();
  if (userId) {
    const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
    if (role === "teacher") redirect("/teacher");
    if (role === "student") redirect("/student");
  }

  return (
    <div className={board.page}>
      <Masthead home="/" />
      <main className={`${board.main} ${board.wide}`}>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <Reveal className={styles.heroCol}>
            <h1 className={styles.heroTitle}>
              Chấm bài <span className={styles.heroAccent}>IELTS Writing</span> nhanh hơn với{" "}
              <span className={styles.heroAccent}>trợ lý AI</span>
            </h1>
            <p className={styles.heroText}>
              Idest để AI đọc và chấm nháp mỗi bài học viên nộp trong vài phút — bốn tiêu chí
              IELTS, kèm nhận xét. Bạn chỉ cần sửa lại chỗ sai và duyệt, thay vì chấm tay từ đầu.
              Bản của AI và bản của bạn luôn được lưu tách riêng, không bản nào ghi đè bản nào.
            </p>
            <div className={styles.heroActions}>
              <Link href="/sign-up" className={styles.ctaPrimary}>
                Tạo tài khoản giáo viên
              </Link>
              <Link href="/sign-in" className={styles.ctaGhost}>
                Đăng nhập
              </Link>
            </div>
            <p className={styles.heroNote}>
              Học viên vào bằng lời mời từ giáo viên của mình — hoàn toàn miễn phí.
            </p>
          </Reveal>

          <Reveal className={styles.demoWrap}>
            <span className={styles.stickerTape} aria-hidden="true">
              AI + bạn = hết lo!
            </span>
            <svg
              className={styles.stickerArrow}
              viewBox="0 0 90 70"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6c10 20 16 38 34 48 14 8 30 8 46 2" />
              <path d="M74 46l14 10-16 6" />
            </svg>
            <span className={styles.stickerArrowNote} aria-hidden="true">
              Quá đỉnh :))
            </span>
            <Image
              src="/logo-icon.png"
              alt=""
              width={64}
              height={64}
              className={styles.stickerLogo}
              aria-hidden="true"
            />
            <svg
              className={styles.stickerSpark}
              viewBox="0 0 40 40"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20 0l3.2 14.8L38 20l-14.8 3.2L20 40l-3.2-16.8L0 20l16.8-3.2Z" />
            </svg>
            <div className={styles.demo}>
              <div className={styles.demoHead}>
                <span>Bài chấm · ví dụ minh họa</span>
                <span>Task 2 · 268 từ</span>
              </div>
              <div className={styles.demoStrip}>
                <div className={styles.demoSlug}>
                  <span>BB-4F2A19/2</span>
                  <span>gemini-2.0-flash · v1</span>
                </div>
                <p className={styles.demoEssay}>
                  “Some people believe that university education should focus on preparing
                  students for future employment. In my opinion, I strongly agree with this view
                  because technical skills and job readiness are essential…”
                </p>
                <div className={styles.demoRows}>
                  <div className={styles.demoRow}>
                    <span className={styles.demoName}>Task Response</span>
                    <span className={`${styles.demoMachine} ${styles.demoMachineStruck}`}>6.5</span>
                    <span className={styles.demoTeacher}>7.0</span>
                    <span className={styles.demoDelta}>+0.5</span>
                  </div>
                  <div className={styles.demoRow}>
                    <span className={styles.demoName}>Coherence &amp; Cohesion</span>
                    <span className={styles.demoMachine}>7.0</span>
                    <span className={styles.demoTeacher}>7.0</span>
                    <span className={styles.demoDelta}>±0.0</span>
                  </div>
                  <div className={styles.demoRow}>
                    <span className={styles.demoName}>Lexical Resource</span>
                    <span className={`${styles.demoMachine} ${styles.demoMachineStruck}`}>6.0</span>
                    <span className={styles.demoTeacher}>6.5</span>
                    <span className={styles.demoDelta}>+0.5</span>
                  </div>
                  <div className={styles.demoRow}>
                    <span className={styles.demoName}>Grammatical Range &amp; Accuracy</span>
                    <span className={`${styles.demoMachine} ${styles.demoMachineStruck}`}>6.0</span>
                    <span className={styles.demoTeacher}>6.5</span>
                    <span className={styles.demoDelta}>+0.5</span>
                  </div>
                </div>
                <div className={styles.demoFoot}>
                  <span className={styles.demoFootLabel}>Điểm tổng 6.5 → 7.0</span>
                  <span className={styles.demoStamp}>Đã duyệt · minh họa</span>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <Reveal className={styles.sectionHead}>
          <h2 className={styles.h2}>Vì sao thầy cô chọn Idest</h2>
        </Reveal>
        <Reveal stagger className={styles.benefits}>
          {BENEFITS.map((b, i) => (
            <RevealItem key={b.name}>
              <SpotlightCard
                className={`${styles.benefitRow} ${i % 2 === 1 ? styles.benefitRowReverse : ""}`}
                spotlightColor="rgba(240, 148, 66, 0.09)"
              >
                <span className={`${styles.benefitNum} ${b.accent ? styles.benefitNumAccent : ""}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className={styles.benefitBody}>
                  <h3 className={styles.benefitName}>
                    {b.name}
                    {b.hint ? <span className={styles.benefitHint}>({b.hint})</span> : null}
                  </h3>
                  <p className={styles.benefitText}>{b.text}</p>
                </div>
              </SpotlightCard>
            </RevealItem>
          ))}
        </Reveal>

        <Reveal className={styles.sectionHead}>
          <h2 className={styles.h2}>Cách hoạt động</h2>
        </Reveal>
        <Reveal>
          <FlowDiagram steps={STEPS} />
        </Reveal>

        <Reveal className={styles.sectionHead}>
          <h2 className={styles.h2}>Học viên chỉ đọc bản đã duyệt</h2>
        </Reveal>
        <Reveal stagger className={styles.split}>
          <RevealItem>
            <SpotlightCard className={styles.splitCol} spotlightColor="rgba(42, 39, 36, 0.06)">
              <span className={styles.splitLabel}>Học viên thấy</span>
              <div className={styles.splitList}>
                {STUDENT_SEES.map((item) => (
                  <span key={item} className={styles.splitItem}>
                    <span className={styles.splitDash}>—</span>
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            </SpotlightCard>
          </RevealItem>
          <RevealItem>
            <SpotlightCard className={styles.splitColTeacher} spotlightColor="rgba(240, 148, 66, 0.22)">
              <span className={styles.splitColTeacherLabel}>Chỉ bạn thấy</span>
              <div className={styles.splitList}>
                {TEACHER_ONLY.map((item) => (
                  <span key={item} className={styles.splitItem}>
                    <span className={styles.splitDash}>—</span>
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            </SpotlightCard>
          </RevealItem>
        </Reveal>

        <section>
          <Reveal className={styles.close}>
            <div className={styles.closeCatFrame} aria-hidden="true">
              <video className={styles.closeCat} src="/Cat typing.webm" autoPlay loop muted playsInline />
            </div>
            <div className={styles.closeCol}>
              <h2 className={styles.closeTitle}>
                Đăng ký liền hông? <span className={styles.closeHint}>(free đó nhen)</span>
              </h2>
              <p className={styles.closeText}>
                Tạo tài khoản giáo viên để mở trang tổng quan của bạn, mời học viên vào lớp, và bắt
                đầu để AI đọc bài trước bạn.
              </p>
            </div>
            <div className={styles.closeAction}>
              <Link href="/sign-up" className={styles.ctaPrimary}>
                Tạo tài khoản giáo viên
              </Link>
              <span className={styles.closeNote}>Học viên vào bằng lời mời từ giáo viên</span>
            </div>
          </Reveal>
        </section>
      </main>
    </div>
  );
}
