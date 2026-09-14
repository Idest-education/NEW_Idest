"use client";

import { use } from "react";
import { SignIn } from "@clerk/nextjs";
import styles from "../../../../auth.module.css";

// Scoped to one invite link so the redirect after sign-in can return here —
// the global /sign-in page forces "/" instead, which would otherwise strand
// an invited student who came from a class join link.
export default function JoinSignInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <div className={styles.wrap}>
      <SignIn signUpUrl={`/join/${token}/sign-up`} forceRedirectUrl={`/join/${token}`} />
    </div>
  );
}
