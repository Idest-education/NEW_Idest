import { auth } from "@clerk/nextjs/server";
import { Composer } from "../components/composer";
import { Landing } from "../components/landing";

/** Signed in: straight to the grader. Signed out: what AIO is, with the grader inside. */
export default async function HomePage() {
  const { userId } = await auth();
  return userId ? <Composer /> : <Landing />;
}
