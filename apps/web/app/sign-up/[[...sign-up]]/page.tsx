import { SignUp } from "@clerk/nextjs";
import styles from "../../auth.module.css";

export default function Page() {
  // Force the post-signup destination to /welcome rather than honouring any
  // redirect_url query param: that param can point at a role-gated route
  // (e.g. /student) which the proxy middleware bounces before the role claim
  // is visible. /welcome is never role-gated, so it's always safe to land on
  // straight away, and it's where a brand-new account picks a display name
  // before being sent on to its dashboard.
  return (
    <div className={styles.wrap}>
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/welcome" />
    </div>
  );
}
