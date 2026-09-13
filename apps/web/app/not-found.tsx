import Image from "next/image";
import Link from "next/link";
import { Masthead } from "../components/masthead";
import board from "./../components/board.module.css";

export default function NotFound() {
  return (
    <div className={board.page}>
      <Masthead home="/" />
      <main className={board.main}>
        <div className={board.blank}>
          <Image src="/404.png" alt="" width={1500} height={1500} className={board.blankArt} />
          <p className={board.blankTitle}>Không tìm thấy trang này</p>
          <p className={board.blankText}>
            Đường dẫn bạn mở không tồn tại. Quay lại trang chủ để tìm bài cần xem.
          </p>
          <Link href="/" className={board.press} style={{ marginTop: "0.6rem" }}>
            Về trang chủ
          </Link>
        </div>
      </main>
    </div>
  );
}
