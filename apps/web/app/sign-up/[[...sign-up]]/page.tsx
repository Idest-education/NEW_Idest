import { SignUp } from "@clerk/nextjs";

export default function Page() {
  // Same fix as the sign-in page: force the post-signup destination to "/"
  // so an invitation's implicit redirect_url can never bounce the freshly
  // created student into a role-gated route before the role claim exists.
  return (
    <SignUp signInUrl="/sign-in" forceRedirectUrl="/" />
  );
}
