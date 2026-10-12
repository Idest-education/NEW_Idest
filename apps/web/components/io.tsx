"use client";

import { useState, type CSSProperties } from "react";
import { useReducedMotion } from "../lib/motion";
import styles from "./io.module.css";

export type IoMood = "idle" | "sleepy" | "reading" | "scoring" | "celebrate" | "oops" | "busy" | "lost";

// Three lopsided outlines with the same commands, so the body can morph between them.
const BLOB = [
  "M80 40 C108 38 128 58 130 86 C132 114 112 132 82 132 C50 133 28 116 30 88 C32 60 52 42 80 40 Z",
  "M77 44 C110 40 133 62 131 89 C130 116 110 131 80 131 C51 132 29 114 31 86 C33 58 49 46 77 44 Z",
  "M83 41 C106 39 127 56 128 84 C131 112 114 133 84 132 C52 134 27 118 29 90 C31 62 55 43 83 41 Z",
];
const EASE = ".45 0 .55 1;.45 0 .55 1;.45 0 .55 1";
const INK = "var(--ink)";
const line = { stroke: INK, strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

const FACE: Record<IoMood, [Eyes, Mouth]> = {
  idle: ["open", "smile"],
  sleepy: ["closed", "sleepy"],
  reading: ["open", "soft"],
  scoring: ["up", "hmm"],
  celebrate: ["happy", "open"],
  oops: ["worried", "wavy"],
  busy: ["happy", "smile"],
  lost: ["open", "o"],
};
type Eyes = "open" | "up" | "closed" | "happy" | "worried";
type Mouth = "smile" | "soft" | "o" | "sleepy" | "open" | "wavy" | "hmm";

/**
 * Io, AIO's mascot: the logo's circle as a soft, slightly lopsided blob.
 * Decorative by default; pass `label` when Io is the only thing saying what is happening.
 */
export function Io({
  mood = "idle",
  size = 64,
  label,
  boopable = false,
  className,
}: {
  mood?: IoMood;
  size?: number;
  label?: string;
  boopable?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [boop, setBoop] = useState(false);
  const [eyes, mouth] = FACE[mood];

  const svg = (
    <svg
      className={`${styles.io} ${styles[mood]} ${boop ? styles.boop : ""} ${!boopable && className ? className : ""}`}
      width={size}
      height={size}
      viewBox="22 28 116 116"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onAnimationEnd={(e) => e.animationName.includes("boop") && setBoop(false)}
    >
      <ellipse className={styles.shadow} cx="80" cy="136" rx="40" ry="5.5" fill={INK} opacity=".12" />
      <g className={styles.body}>
        <path d={BLOB[0]} fill="var(--accent)">
          {!reduce && (
            <animate
              attributeName="d"
              dur={mood === "busy" ? "2.4s" : "5s"}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes="0;.33;.66;1"
              keySplines={EASE}
              values={`${BLOB[0]};${BLOB[1]};${BLOB[2]};${BLOB[0]}`}
            />
          )}
        </path>
        <path d="M49 72 C53 60 62 52 73 50" stroke="#fff" strokeOpacity=".5" strokeWidth="5.5" strokeLinecap="round" fill="none" />
        <circle cx="46" cy="83" r="2.6" fill="#fff" opacity=".45" />
        <ellipse cx="56" cy="102" rx="8" ry="5" fill="var(--pop)" opacity=".75" />
        <ellipse cx="105" cy="99" rx="7.2" ry="4.6" fill="var(--pop)" opacity=".75" />
        <IoEyes kind={eyes} />
        <IoMouth kind={mouth} />
      </g>
      <g className={styles.fx}>
        <IoExtra mood={mood} />
      </g>
    </svg>
  );

  if (!boopable) return svg;
  return (
    <button type="button" className={`${styles.boopButton} ${className ?? ""}`} aria-label="Boop Io" onClick={() => setBoop(true)}>
      {svg}
    </button>
  );
}

function Dots({ dy = 0 }: { dy?: number }) {
  // One eye a touch bigger and higher: hand-made, not machine-made.
  return (
    <g className={styles.look}>
      <g className={styles.eye}>
        <ellipse cx="66" cy={86 + dy} rx="5.6" ry="7.6" fill={INK} />
        <circle cx="68" cy={83 + dy} r="1.9" fill="#fff" />
      </g>
      <g className={styles.eye}>
        <ellipse cx="95" cy={84 + dy} rx="5" ry="7" fill={INK} />
        <circle cx="96.8" cy={81 + dy} r="1.7" fill="#fff" />
      </g>
    </g>
  );
}

function IoEyes({ kind }: { kind: Eyes }) {
  if (kind === "open") return <Dots />;
  if (kind === "up") return <Dots dy={-3} />;
  if (kind === "closed")
    return (
      <>
        <path d="M59 88 Q66 93 73 88" {...line} />
        <path d="M89 86 Q95 91 101 86" {...line} />
      </>
    );
  if (kind === "happy")
    return (
      <>
        <path d="M59 89 Q66 80 73 89" {...line} />
        <path d="M89 87 Q95 79 101 87" {...line} />
      </>
    );
  return (
    <>
      <Dots dy={1} />
      <path d="M59 77 Q65 75 71 72" {...line} strokeWidth={2.6} />
      <path d="M101 75 Q95 73 90 70" {...line} strokeWidth={2.6} />
    </>
  );
}

function IoMouth({ kind }: { kind: Mouth }) {
  switch (kind) {
    case "soft":
      return <path d="M77 102 Q81 104 85 101.5" {...line} />;
    case "o":
      return <ellipse cx="81.5" cy="103" rx="3" ry="3.4" fill={INK} />;
    case "sleepy":
      return <ellipse cx="81" cy="103" rx="2.6" ry="2" fill={INK} />;
    case "open":
      return (
        <>
          <path d="M73 98 Q81 111 90 97 Q81 101 73 98 Z" fill={INK} />
          <ellipse cx="82" cy="104.5" rx="3.6" ry="2" fill="var(--pop)" />
        </>
      );
    case "wavy":
      return <path d="M74 104 Q78 100 82 104 Q86 108 90 103" {...line} />;
    case "hmm":
      return <path d="M77 102.5 Q81 101 86 102" {...line} />;
    default:
      return <path d="M76 101 Q81 106 87 100" {...line} />;
  }
}

const star = (x: number, y: number) =>
  `M${x} ${y - 7} Q${x + 1.4} ${y - 1.4} ${x + 7} ${y} Q${x + 1.4} ${y + 1.4} ${x} ${y + 7} Q${x - 1.4} ${y + 1.4} ${x - 7} ${y} Q${x - 1.4} ${y - 1.4} ${x} ${y - 7} Z`;
const textProps = { fontFamily: "var(--font-sans)", fontWeight: 800 } as const;

function IoExtra({ mood }: { mood: IoMood }) {
  switch (mood) {
    case "sleepy":
      return (
        <>
          <text x="112" y="56" fontSize="17" fill="var(--accent-text)" {...textProps}>
            z
          </text>
          <text x="124" y="42" fontSize="12" fill="var(--accent-text)" {...textProps}>
            z
          </text>
        </>
      );
    case "scoring":
      return (
        <>
          <circle cx="104" cy="34" r="3.4" fill="var(--accent)" />
          <circle cx="115" cy="30" r="3.4" fill="var(--accent)" />
          <circle cx="126" cy="26" r="3.4" fill="var(--accent)" />
        </>
      );
    case "celebrate":
      return (
        <>
          <path d={star(32, 50)} fill="var(--mark-bg)" />
          <path d={star(130, 40)} fill="var(--pop)" />
          <path d={star(136, 92)} fill="var(--ok)" />
          <path d={star(26, 98)} fill="var(--accent)" />
        </>
      );
    case "oops":
      return <path d="M120 60 C123 65 125 68 125 71.5 A5 5 0 0 1 115 71.5 C115 68 117 65 120 60 Z" fill="var(--accent)" />;
    case "busy":
      return (
        <>
          {(
            [
              ["var(--surface)", "-30px", "-24deg"],
              ["var(--mark-bg)", "4px", "12deg"],
              ["var(--surface)", "32px", "30deg"],
            ] as const
          ).map(([fill, dx, rot]) => (
            <rect
              key={dx}
              x="74"
              y="34"
              width="11"
              height="14"
              rx="2.5"
              fill={fill}
              stroke={INK}
              strokeWidth="1.6"
              style={{ "--dx": dx, "--rot": rot } as CSSProperties}
            />
          ))}
        </>
      );
    case "lost":
      return (
        <text x="116" y="50" fontSize="26" fill="var(--pop)" {...textProps}>
          ?
        </text>
      );
    default:
      return null;
  }
}
