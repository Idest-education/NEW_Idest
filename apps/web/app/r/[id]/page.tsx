import type { Metadata } from "next";
import { ResultView } from "../../../components/result-view";

export const metadata: Metadata = {
  title: "IELTS Writing result",
  description: "Band score and feedback for an IELTS Writing essay, graded by AIO.",
};

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultView key={id} id={id} />;
}
