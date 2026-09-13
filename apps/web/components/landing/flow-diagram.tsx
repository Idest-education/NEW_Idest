"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import styles from "./flow-diagram.module.css";
import { STEP_ART } from "./step-art";

export function FlowDiagram({ steps }: { steps: { name: string; text: string }[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className={styles.flow}>
      <div className={styles.track}>
        <div
          className={styles.trackFill}
          style={{ width: `${(active / (steps.length - 1)) * 100}%` }}
          aria-hidden="true"
        />
        {steps.map((step, i) => (
          <button
            key={step.name}
            type="button"
            className={`${styles.node} ${i <= active ? styles.nodeActive : ""} ${i === active ? styles.nodeCurrent : ""}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            aria-pressed={i === active}
          >
            <span className={styles.nodeDot}>{i + 1}</span>
            <span className={styles.nodeLabel}>{step.name}</span>
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className={styles.panelInner}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className={styles.panelArt} aria-hidden="true">
              {(() => {
                const Art = STEP_ART[active];
                return Art ? <Art /> : null;
              })()}
            </span>
            <p className={styles.panelText}>{steps[active]?.text}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
