---
version: 1
slug: "app"
primary_target: "app"
related_targets: []
---

Scope: the whole Idest web client — signed-in teacher and student app (Operate) plus the public entry page (Persuade). Vietnamese UI, English essay content, fully responsive, every screen wired to the existing NestJS API.

Audience: freelance IELTS tutors working a queue of essays between classes; Vietnamese learners reading the band their teacher signed. Task: the teacher pulls a submission out of the queue, overrules the AI where it is wrong, and signs it; the student writes, watches the queue, and reads a signed sheet.

Content and constraints: assignments, submissions, scoring results, revisions, publish/unpublish, history, invitations — no endpoint invented, no score, testimonial, or metric invented. Append-only truth stays visible to the teacher; students see published results only. Brand assets on hand: `public/logo.png` (orange wordmark), `logo-icon.png`, four mascot rasters (`assignment-writing/reading/listening/speaking.png`), `404.png`, `default-avatar.png`.

## Direction contract

THESIS: Every essay is a strip in a bay, and no strip leaves the board without the teacher's initials on it. The queue is not a table of rows — it is a physical board where each submission occupies a holder, moves bay by bay, and carries its own printed record. It refuses the ed-tech dashboard arrangement (sidebar rail, white cards, coloured status pills, score donuts) and refuses the gamified learner app (streaks, confetti, progress rings).

OWN-WORLD: Neutral warm operations board. Ground `#F6F5F2` with a 1px vertical rib, rack `#E8E5DE`, strip stock `#FFFFFF`, ink `#2A2724`, machine print `#625D56`, brand orange `#F7941E`, mark orange `#A04703`, alert `#9C2C1F`, cleared `#3F6B27`. Palette decision, recorded: the user first steered the roll's dark console to "light orange to match the logo", then on seeing it said "the orange look bad" and chose *too much orange everywhere* — so the ground is neutral warm stock and orange is rationed to exactly three places: the marking rail, the teacher's own marks, and the logo. Nothing on the board itself (bays, strips, masthead, primary buttons) is orange; strips carry state as physical treatment — ribbed holder clips, hatching, seat depth, stamps — never as colour alone. Type: Be Vietnam Pro for Vietnamese UI, JetBrains Mono for every machine-set figure (bands, word counts, refs, timestamps, deviations), Source Serif 4 for the essay specimen. Components are board furniture: strips seated in holders, bay rails, punched sheet edges, rubber stamps, commit blocks. No cards, no pills, no rounded panels, no donuts. The mascot appears only where the board is empty or broken (empty bay, no AI result, 404) — never beside working content.

STORY: A teacher opens the board and sees every essay's position at a glance, with the AI's figures already machine-printed on each strip. They pull one, read it, overwrite what is wrong in orange over the machine print, see exactly what the student will get, then stamp it. A student sees their own strip travel the bays and, once it is stamped, reads the signed sheet — never the machine's draft underneath.

FIRST VIEWPORT (teacher review, the product's core): full-bleed board. A header strip carries ref, student, task, attempt, word count, submit stamp. The essay sits left on strip stock at a 68ch measure with mono line numbers punched down the outer edge. The right third is the marking rail: the overall band figure at monumental scale (the largest object on the screen) with the AI's machine-printed figure struck beside it, then four criterion rows each showing printed AI figure, the teacher's written field, and the deviation on one rule. The commit block sits at the foot: revision note, a preview of the exact student sheet, then the stamp action. Nothing is coloured-only — every strip and field state has a physical treatment.

SIGNATURE INTERACTION: the overwrite. The AI's figure is machine-printed and permanent; the teacher's value is written over it, the printed figure ruled through and still legible beneath, so append-only history is seen rather than described. Stamping runs a single authored press: the stamp lands, the strip seats into the signed bay, the student sheet becomes readable. Motion is press and seat, exponential ease-out, instant under reduced-motion.

FORM: Strip Bay — candidate 7 of the grounded list (flight progress strip boards), the roll's assignment; my own top candidate, the Band Descriptor Grid, was offered as the pick and declined by the user. Seed key 78d20982. Code-led build, user-steered palette. Raises taken from the declined challengers: exhaustive physical state vocabulary (One-Bit Desktop), a visible commit threshold with pre-commit student preview (Darkroom Safelight), ground colour committed at full page scale (Seedbed Lobes), the band figure at monumental scale (Alphabet Storm), one control propagating across the linked field (Miura Sheet).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Unresolved: teacher rescore/retry has no API endpoint — student copy must not promise one until it exists. Admin role has no endpoints and ships no surface.
