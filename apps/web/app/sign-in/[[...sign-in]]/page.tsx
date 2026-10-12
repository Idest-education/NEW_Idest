import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import Image from "next/image";
import welcomeIo from "../../../public/illustrations/welcome-io.webp";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="page" style={{ justifyItems: "center" }}>
      <Image src={welcomeIo} alt="" sizes="280px" priority style={{ width: 280, height: "auto", maxWidth: "100%" }} />
      <SignIn />
    </div>
  );
}
