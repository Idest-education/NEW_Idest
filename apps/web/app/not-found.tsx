import Link from "next/link";
import Image from "next/image";
import notFound from "../public/illustrations/not-found.webp";

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="card stack" style={{ justifyItems: "start", padding: 32 }}>
        <Image src={notFound} alt="" sizes="360px" priority style={{ width: 360, height: "auto", maxWidth: "100%" }} />
        <h1 style={{ fontSize: "var(--fs-22)" }}>Io looked everywhere. This page isn&apos;t here.</h1>
        <p className="muted">The link may be old or mistyped. Let&apos;s grade something instead.</p>
        <Link className="btn btn-primary" href="/">
          Grade an essay
        </Link>
      </div>
    </div>
  );
}
