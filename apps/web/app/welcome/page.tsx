"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { acceptInviteLink, getProfile, updateProfile } from "../../lib/idest";
import { waitForRoleClaim } from "../../lib/session-claims";
import { useAction } from "../../lib/use-api";
import styles from "./welcome.module.css";

const MESSAGES = [
  "Idest đang tạo tài khoản cho bạn...",
  "Đang thiết lập AI…",
  "Chọn không gian hợp với bạn nhất…",
  "Sắp xong rồi nè…",
];

const MIN_LOADING_MS = 2600;
const MESSAGE_INTERVAL_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function WelcomePage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { busy, error, run } = useAction();

  const [joinToken, setJoinToken] = useState<string | null | undefined>(undefined);
  const [step, setStep] = useState<"name" | "loading" | "stuck">("name");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setJoinToken(new URLSearchParams(window.location.search).get("join"));
  }, []);

  useEffect(() => {
    if (user && !name) {
      setName(user.fullName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (step !== "loading") return;
    const id = setInterval(() => setMessageIndex((i) => (i + 1) % MESSAGES.length), MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [step]);

  const finish = useCallback(async () => {
    const started = Date.now();
    const landed = await run(async (token) => {
      if (joinToken) {
        const joined = await acceptInviteLink(token, joinToken);
        return `/student/classes/${joined.classId}`;
      }
      const profile = await getProfile(token);
      return profile.role === "teacher" ? "/teacher" : "/student";
    });

    if (!landed) {
      setStep("stuck");
      return;
    }

    // Mint tokens until one carries the just-set role. Navigating on a token
    // that still lacks the claim bounces off the role gate on the way in.
    await waitForRoleClaim(getToken);
    const elapsed = Date.now() - started;
    if (elapsed < MIN_LOADING_MS) await sleep(MIN_LOADING_MS - elapsed);
    window.location.href = landed;
  }, [joinToken, run, getToken]);

  const submitName = useCallback(async () => {
    if (!name.trim()) {
      setFormError("Nhập tên hiển thị của bạn.");
      return;
    }
    setFormError(null);
    setStep("loading");
    setMessageIndex(0);
    const saved = await run((token) => updateProfile(token, name.trim()));
    if (!saved) {
      setStep("name");
      return;
    }
    await finish();
  }, [name, run, finish]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {step === "name" ? (
          <>
            <span className={styles.eyebrow}>Idest</span>
            <h1 className={styles.title}>Chào mừng bạn!</h1>
            <p className={styles.subtitle}>Đặt tên hiển thị để giáo viên và học viên nhận ra bạn.</p>
            <input
              className={styles.field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
              }}
              placeholder="Tên của bạn"
              autoFocus
            />
            {formError ? <p className={styles.formError}>{formError}</p> : null}
            {error ? <p className={styles.formError}>{error}</p> : null}
            <button type="button" className={styles.button} disabled={busy} onClick={submitName}>
              {busy ? "Đang lưu…" : "Tiếp tục →"}
            </button>
          </>
        ) : step === "loading" ? (
          <>
            <span className={styles.stamp} aria-hidden="true">
              ✦
            </span>
            <h1 className={styles.title}>Đang chuẩn bị cho bạn…</h1>
            <p className={styles.message} key={messageIndex} aria-live="polite">
              {MESSAGES[messageIndex]}
            </p>
          </>
        ) : (
          <>
            <span className={styles.eyebrow}>Idest</span>
            <h1 className={styles.title}>Hơi trục trặc một chút</h1>
            <p className={styles.subtitle}>{error ?? "Không chuẩn bị được không gian của bạn. Thử lại nhé."}</p>
            <button type="button" className={styles.buttonQuiet} onClick={finish}>
              Thử lại
            </button>
          </>
        )}
      </div>
    </div>
  );
}
