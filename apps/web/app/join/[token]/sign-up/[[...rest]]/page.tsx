"use client";

import { use } from "react";
import { SignUp } from "@clerk/nextjs";
import styles from "../../../../auth.module.css";

// Scoped to one invite link, for two reasons: the new account must be
// created as a student — unsafeMetadata carries that hint to the backend's
// user-sync step (see apps/server/src/auth/user-sync.service.ts) — and the
// post-signup redirect must carry the invite token through /welcome so it
// can join the class automatically once the account is set up.
export default function JoinSignUpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <div className={styles.wrap}>
      <SignUp
        signInUrl={`/join/${token}/sign-in`}
        forceRedirectUrl={`/welcome?join=${token}`}
        unsafeMetadata={{ role: "student" }}
      />
    </div>
  );
}
