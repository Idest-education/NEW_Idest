import { SignIn } from "@clerk/nextjs";
import styles from "../../auth.module.css";

export default function Page() {
  return (
    // Force the destination to the landing page rather than honouring any
    // `redirect_url` query param. That param can point at a role-gated route
    // (e.g. /student) which the proxy middleware bounces before the role
    // claim is visible, and Clerk's own redirect-loop guard then renders
    // this page blank instead of erroring. Landing on "/" is always public,
    // does its own single server-verified role redirect, and never loops.
    <div className={styles.wrap}>
      <SignIn signUpUrl="/sign-up" forceRedirectUrl="/" />
    </div>
  );
}
