import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="page" style={{ justifyItems: "center" }}>
      <SignUp />
    </div>
  );
}
