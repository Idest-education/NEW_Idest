import { Composer } from "./composer";
import styles from "./landing.module.css";

/** The signed-out home page: one line on what AIO is, then a working grader. */
export function Landing() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-h">
        <h1 id="hero-h" className={styles.headline}>
          Know your Writing band <span className={styles.highlight}>before exam day.</span>
        </h1>
        <p className={styles.lead}>Free IELTS Writing grading in about a minute. No account needed.</p>
      </section>

      <section id="grade" className={styles.grade} aria-labelledby="grade-h">
        <h2 id="grade-h" className={styles.h2}>
          Try it now
        </h2>
        <Composer variant="landing" />
      </section>
    </div>
  );
}
