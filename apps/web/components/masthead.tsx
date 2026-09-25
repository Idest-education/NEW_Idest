"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useAuth } from "@clerk/nextjs";
import type { Role } from "@repo/auth-contract";
import styles from "./board.module.css";

const ROLE_LABEL: Record<Role, string> = {
  student: "Học viên",
  teacher: "Giáo viên",
  admin: "Quản trị",
};

export function Masthead({ role, home }: { role?: Role; home?: string }) {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const base = home ?? (role === "teacher" ? "/teacher" : role === "student" ? "/student" : "/");

  return (
    <header className={styles.masthead}>
      <div className={styles.mastheadInner}>
        <Link href={base} className={styles.wordmark} aria-label="Idest — về bảng chấm">
          <Image
            src="/logo.png"
            alt="Idest"
            width={600}
            height={400}
            className={styles.wordmarkImg}
            priority
          />
        </Link>
        {role ? <span className={styles.mastheadRole}>{ROLE_LABEL[role]}</span> : null}

        <nav className={styles.mastheadNav}>
          {isSignedIn ? (
            <>
              <Link
                href={base}
                className={`${styles.navLink} ${pathname === base ? styles.navLinkActive : ""}`}
              >
                Trang chủ
              </Link>
              <Link
                href="/help"
                className={`${styles.navLink} ${pathname === "/help" ? styles.navLinkActive : ""}`}
              >
                Trợ giúp
              </Link>
              <Link
                href="/profile"
                className={`${styles.navLink} ${pathname === "/profile" ? styles.navLinkActive : ""}`}
              >
                Tài khoản
              </Link>
              <SignOutButton>
                <button type="button" className={styles.navLink}>
                  Đăng xuất
                </button>
              </SignOutButton>
            </>
          ) : (
            <Link href="/sign-in" className={styles.navLink}>
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
