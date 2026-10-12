import Image from "next/image";
import Link from "next/link";
import emptyBatches from "../public/illustrations/empty-batches.webp";
import { Composer } from "./composer";
import { Icon } from "./icon";
import { Io } from "./io";
import { Logo } from "./logo";
import styles from "./landing.module.css";

const STEPS = [
  {
    title: "Paste or snap",
    body: "Type or paste your essay, or upload up to 5 photos of a handwritten one. For Task 1, paste the chart in too.",
  },
  {
    title: "Io reads it",
    body: "Your essay is scored against the four official IELTS criteria: Task Response, Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy.",
  },
  {
    title: "Get your band and fixes",
    body: "See your overall band, why each criterion got its score, and a better version of every sentence that held you back.",
  },
];

const SAMPLE = [
  { short: "TR", band: "6.5", tone: "good" },
  { short: "CC", band: "7.0", tone: "good" },
  { short: "LR", band: "6.0", tone: "mid" },
  { short: "GRA", band: "6.5", tone: "good" },
];

const FAQ = [
  {
    q: "Is it really free?",
    a: "Yes. Anyone can grade up to 10 essays a day without an account. Teachers who sign in grade without a daily limit.",
  },
  {
    q: "How accurate is the band?",
    a: "Io is an AI grader, so treat its band as a strong estimate, not an official IELTS score. On AIO, teachers review and finalize the scores for their own classes.",
  },
  {
    q: "What happens to my essay?",
    a: "We store essays and results to improve grading. Anyone with your result link can open it, so share it only with people you trust.",
  },
  {
    q: "Does it grade Task 1?",
    a: "Yes. Add the chart as an image, by uploading or pasting it, and Io grades your report against it.",
  },
];

/** The signed-out home page: what AIO is, a working grader, and the case for teachers. */
export function Landing() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-h">
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>Free IELTS Writing grader</p>
          <h1 id="hero-h" className={styles.headline}>
            Know your Writing band <span className={styles.highlight}>before exam day.</span>
          </h1>
          <p className={styles.lead}>
            Paste an essay or snap a photo of your handwriting. In about a minute you get a band for each of the four
            criteria, the reasons behind it, and a fix for every weak sentence.
          </p>
          <div className={styles.ctas}>
            <a href="#grade" className="btn btn-primary">
              <Icon name="edit_square" /> Grade my essay, free
            </a>
            <Link href="/sign-up" className="btn btn-secondary">
              I teach IELTS
            </Link>
          </div>
          <ul className={styles.trust}>
            <li>
              <Icon name="check" /> No account needed
            </li>
            <li>
              <Icon name="check" /> Task 1 and Task 2
            </li>
            <li>
              <Icon name="check" /> Photos of handwriting
            </li>
          </ul>
        </div>
        <div className={styles.heroArt}>
          <Io mood="idle" size={200} boopable />
          <span className={`${styles.floatChip} ${styles.chipA}`} aria-hidden="true">
            <b className="tone-good">7.0</b> Good user
          </span>
          <span className={`${styles.floatChip} ${styles.chipB}`} aria-hidden="true">
            <b className="tone-mid">LR 6.0</b> try “nutritious”
          </span>
        </div>
      </section>

      <section id="grade" className={styles.grade} aria-labelledby="grade-h">
        <h2 id="grade-h" className={styles.h2}>
          Try it now
        </h2>
        <Composer variant="landing" />
      </section>

      <section className={styles.section} aria-labelledby="how-h">
        <h2 id="how-h" className={styles.h2}>
          How it works
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span className={styles.stepNo}>{i + 1}</span>
              <h3 className={styles.h3}>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.split}`} aria-labelledby="get-h">
        <div className={styles.splitText}>
          <h2 id="get-h" className={styles.h2}>
            More than a number
          </h2>
          <p className="muted">
            Every criterion gets its own band and a plain-English comment. Hover any highlighted sentence to see what
            went wrong and a better way to say it.
          </p>
        </div>
        <figure className={styles.sample} aria-label="Example result">
          <span className={styles.sampleTag}>Example</span>
          <div className={styles.sampleTop}>
            <span className={`${styles.sampleBand} tone-good`}>6.5</span>
            <span className="muted">Overall band · Competent user</span>
          </div>
          <div className={styles.sampleCrit}>
            {SAMPLE.map((c) => (
              <span key={c.short} className={`tile-${c.tone}`}>
                <b className={`tone-${c.tone}`}>{c.band}</b> {c.short}
              </span>
            ))}
          </div>
          <p className={styles.sampleEssay}>
            Many people eat fast food because <mark className={styles.sampleMark}>it is very good taste.</mark> However,
            the effects on health are serious.
          </p>
          <div className={styles.samplePop}>
            <span className="chip">GRA · Grammatical Range &amp; Accuracy</span>
            <p className="muted">“Good taste” is a noun phrase; it needs a verb.</p>
            <p>
              <b className="tone-good">Try →</b> because it tastes very good.
            </p>
          </div>
        </figure>
      </section>

      <section className={`${styles.section} ${styles.split} ${styles.teachers}`} aria-labelledby="teach-h">
        <Image src={emptyBatches} alt="" sizes="(max-width: 800px) 90vw, 420px" className={styles.teachArt} />
        <div className={styles.splitText}>
          <p className={styles.eyebrow}>For teachers</p>
          <h2 id="teach-h" className={styles.h2}>
            Grading a whole class? Hand Io the pile.
          </h2>
          <ul className={styles.bullets}>
            <li>Upload photos, PDF, Word or Excel, up to 30 files at a time.</li>
            <li>Io finds every essay and grades it. You check, edit and finalize each score.</li>
            <li>Download the scores as Excel, added to your own spreadsheet.</li>
          </ul>
          <Link href="/sign-up" className="btn btn-primary">
            Create a free teacher account
          </Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="faq-h">
        <h2 id="faq-h" className={styles.h2}>
          Questions
        </h2>
        <div className={styles.faq}>
          {FAQ.map((f) => (
            <details key={f.q} className={styles.faqItem}>
              <summary>{f.q}</summary>
              <p className="muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <Logo />
        <span className="muted">Free IELTS Writing grading, with a teacher in the loop.</span>
        <Link href="/sign-in" className={styles.footerLink}>
          Sign in
        </Link>
      </footer>
    </div>
  );
}
