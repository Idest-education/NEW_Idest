import path from "node:path";
import dotenv from "dotenv";
import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Loads the repo env, then asks Clerk for a testing token so the sign-in helper
 * can bypass bot protection on the test instance.
 */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, ".env.local"), override: true });

  const publishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (!publishable.startsWith("pk_test")) {
    throw new Error(
      "These tests sign in with +clerk_test addresses, which only work on a Clerk " +
        "test instance. NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a pk_test key.",
    );
  }

  await clerkSetup();
}
