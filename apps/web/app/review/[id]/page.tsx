import type { Metadata } from "next";
import { Review } from "../../../components/review";
import { RoleGate } from "../../../components/session";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGate access="teacher">
      <Review key={id} id={id} />
    </RoleGate>
  );
}
