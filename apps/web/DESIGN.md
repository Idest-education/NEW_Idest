---
name: Idest
description: A warm neutral operations board where every essay is a strip in a bay and nothing leaves without the teacher's stamp.
colors:
  board: "#f6f5f2"
  board-deep: "#eeece7"
  rack: "#e8e5de"
  rack-edge: "#d5d1c7"
  stock: "#ffffff"
  stock-edge: "#e2dfd7"
  ink: "#2a2724"
  ink-soft: "#514c45"
  ink-quiet: "#635d55"
  machine: "#625d56"
  orange: "#f7941e"
  orange-deep: "#a04703"
  orange-wash: "#fdf0e0"
  alert: "#9c2c1f"
  alert-wash: "#f6e2dd"
  cleared: "#3f6b27"
  cleared-wash: "#f1f7ea"
  rule: "#ddd9d0"
  rule-strong: "#c3beb2"
  bay-current: "#dcd8cf"
  press-ink: "#1c1a18"
  press-hover: "#3b3733"
  press-label: "#f8f7f4"
  orange-ink: "#7d3703"
  alert-ink: "#7d2318"
  cleared-ink: "#33571f"
  clip-rib: "rgb(255 255 255 / 0.28)"
  clip-edge: "rgb(42 39 36 / 0.18)"
  board-rib: "rgb(42 39 36 / 0.014)"
typography:
  display:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 6vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  figure-monumental:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "clamp(3.4rem, 8vw, 4.6rem)"
    fontWeight: 700
    lineHeight: 0.82
    letterSpacing: "-0.05em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.45rem, 3vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  specimen:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.05rem"
    fontWeight: 400
    lineHeight: 1.72
    letterSpacing: "normal"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.18rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  figure-preview:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  figure-strip:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  body-strong:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body-sm:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  control:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
  caption:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  caption-sm:
    fontFamily: "Be Vietnam Pro, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  figure-sm:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.68rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.05em"
    fontFeature: "tabular-nums"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.62rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.16em"
  label-sm:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  chip:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.58rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.13em"
  abbr:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.55rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.12em"
rounded:
  none: "0"
spacing:
  hair: "0.1rem"
  xs: "0.35rem"
  sm: "0.6rem"
  md: "0.9rem"
  lg: "1.25rem"
  xl: "2.75rem"
  gutter: "clamp(1rem, 3vw, 2.5rem)"
components:
  strip:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.6rem 0.85rem 0.6rem 1.35rem"
  strip-waiting:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
  strip-signed:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
  strip-failed:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.ink}"
  bay:
    backgroundColor: "{colors.rack}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.75rem 0.85rem 1rem"
  press:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.press-label}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.1rem"
    typography: "{typography.title}"
  press-hover:
    backgroundColor: "{colors.press-hover}"
    textColor: "{colors.press-label}"
  press-disabled:
    backgroundColor: "{colors.rack-edge}"
    textColor: "{colors.ink-quiet}"
  criterion-field-refused:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert}"
  press-quiet:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.1rem"
  field:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.6rem 0.7rem"
  criterion-field:
    backgroundColor: "transparent"
    textColor: "{colors.orange-deep}"
    rounded: "{rounded.none}"
    padding: "0.1rem 0.3rem 0.15rem 0"
    typography: "{typography.figure}"
  criterion-field-hover:
    backgroundColor: "{colors.orange-wash}"
    textColor: "{colors.orange-deep}"
  criterion-field-invalid:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert}"
  commit:
    backgroundColor: "{colors.orange-wash}"
    textColor: "{colors.orange-ink}"
    rounded: "{rounded.none}"
    padding: "0.9rem 1rem 1.05rem"
  stamp:
    backgroundColor: "transparent"
    textColor: "{colors.cleared}"
    rounded: "{rounded.none}"
    padding: "0.28rem 0.6rem"
    typography: "{typography.label}"
  notice:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.none}"
    padding: "0.7rem 0.9rem"
  notice-alert:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert-ink}"
  notice-ok:
    backgroundColor: "{colors.cleared-wash}"
    textColor: "{colors.cleared-ink}"
---

# Design System: Idest

## Overview

**Creative North Star: "The Strip Bay"**

Idest looks like a warm, well-used operations board rather than software. Every submission
is a paper strip seated in a holder; holders sit in bays; bays sit on a neutral warm ground
that carries a faint 1px vertical rib at full page scale. Work moves by being pulled out of
one bay and seated into the next, and the board records what happened in machine print and
in the teacher's own hand. Density is high and deliberately clerical: rules and dotted
separators do the dividing, not whitespace and not containers.

The system is built around a single conflict made visible — the machine's figure versus the
teacher's figure. The machine prints in JetBrains Mono at `machine` grey; the teacher writes
in orange over the top, and the machine's number is ruled through but left legible beneath
it. Append-only history is therefore seen rather than explained. The overall band is the
largest object on the marking sheet, set in mono at up to 4.6rem, because the band is the
product.

The palette was resolved during the build, not before it: an earlier steer toward an orange
console was rejected on sight, and the ground settled at neutral warm stock with orange cut
back to three places. That ration is now the system's most load-bearing rule. The world
refuses the ed-tech dashboard (sidebar rail, white cards, coloured status pills, score
donuts) and the gamified learner app (streaks, confetti, progress rings); it also refuses
rounded panels outright — every radius in the build is 0.

**Key Characteristics:**
- Neutral warm ground (`board`) at full page scale, with a 1px vertical rib in body ink at 1.4% alpha.
- Three type voices with fixed jobs: sans for Vietnamese UI, mono for every machine-set figure, serif for the essay specimen only.
- Zero radius, hairline rules, hatching, and seat depth instead of cards and shadows-as-decoration.
- Orange rationed to the marking rail, the teacher's own marks, and the logo.
- State is always physical treatment plus a text label; never colour alone.
- The mascot rasters appear only where the board is empty or broken.

## Colors

A neutral warm stock palette — paper, rack board, and printer grey — pierced by exactly one
warm accent that belongs to the teacher.

### Primary
- **Mark Orange** (`orange-deep`): every figure, rule-through, tick, and border the teacher
  authored. The criterion field's value, the monumental overall band once a teacher owns it,
  the 2px rule struck across the machine's print, the adopt tick, and the commit block's border.
- **Brand Orange** (`orange`): the logo wordmark, the underline of an editable criterion
  field, and the text selection highlight (with `ink` as its foreground). Never a fill for furniture.
- **Mark Wash** (`orange-wash`): the commit block's ground and the hover/focus ground of a
  criterion field — the only places an orange field appears.

### Secondary
- **Machine Grey** (`machine`): everything the AI produced. Printed bands, refs, line numbers,
  AI feedback, AI sentence marks, the holder clip of an AI mark strip. If a figure is grey, a
  machine set it.

### Tertiary
- **Cleared Green** (`cleared`) and **Cleared Wash** (`cleared-wash`): the signed state only —
  the stamp, the signed strip's holder and its left-to-right wash, the signed timeline tick,
  the cleared notice.
- **Alert Red** (`alert`) and **Alert Wash** (`alert-wash`): failure and refusal only — the
  failed strip's diagonal hatch and holder, an out-of-band criterion figure, the alert notice.

### Neutral
- **Press Ink** (`press-ink`), **Press Hover** (`press-hover`), **Press Label** (`press-label`):
  the primary control's own three values — the 1px border and the key-thickness edge under it,
  the ground it lifts to on hover, and the warm off-white its label is set in. They exist
  because the press must read as a solid key against `ink` body text, and they appear nowhere else.
- **Wash Inks** (`orange-ink`, `alert-ink`, `cleared-ink`): the darker text step for each
  accent when it sits on its own wash — the commit block's uppercase head, the alert notice,
  the cleared notice. An accent is never set as text on its own wash without dropping to its
  wash ink.
- **Board** (`board`): the page ground everywhere, plus the punch holes bitten out of the essay sheet.
- **Board Deep** (`board-deep`): masthead gradient top, colophon ground, scrollbar track, disabled adopt box.
- **Rack** (`rack`) and **Rack Edge** (`rack-edge`): bay grounds, rack containers, bay gridlines, scrollbar thumb.
- **Stock** (`stock`) and **Stock Edge** (`stock-edge`): strip, sheet, prompt, and rail-block paper and its cut edge.
- **Ink** (`ink`): body text, the primary press button ground, focus outlines, the under-review holder.
- **Ink Soft** (`ink-soft`) / **Ink Quiet** (`ink-quiet`): secondary prose, micro-labels, placeholders, empty-bay text.
- **Rule** (`rule`) / **Rule Strong** (`rule-strong`): hairline dividers, dotted criterion separators, and section rules.
- **Bay Current** (`bay-current`): the top of the current bay's tonal gradient; the only place a bay differs from `rack`.
- **Clip Rib** (`clip-rib`) / **Clip Edge** (`clip-edge`) / **Board Rib** (`board-rib`): the three
  translucent values that make the board's materials — the horizontal highlight inside every
  holder clip, the dark line closing its right side, and the 1px vertical rib across the page
  ground. They are material, not palette: never use them as text or fill colours.

### Named Rules
**The Rationed Orange Rule.** Orange appears in exactly three places: the marking rail, the
teacher's own marks, and the logo. Nothing the board itself is made of — bays, strips, the
masthead, primary buttons — is ever orange. Audit test: cover the marking rail and the
wordmark; if any orange remains on screen, it is wrong.
One sanctioned exception (product owner, 2026-09-28): the feedback-survey invitation banner on
the `/teacher` and `/student` dashboards is solid orange, so the pilot survey is hard to miss. It
disappears once the user has answered. Do not reuse its styling elsewhere.

**The Two Hands Rule.** Grey is the machine's; orange is the teacher's. A figure never
changes hands by moving — the machine's print stays where it was printed and is ruled
through, and the teacher's figure is written beside it.

**The No-Colour-Only Rule.** No state is carried by hue alone. Every state pairs a physical
treatment (holder colour value, hatching, seat depth, a stamp) with an always-present
uppercase mono text label.

## Typography

**Display / Body Font:** Be Vietnam Pro (with `ui-sans-serif, system-ui, sans-serif`)
**Figure / Label Font:** JetBrains Mono (with `ui-monospace, monospace`)
**Specimen Font:** Source Serif 4 (with `Georgia, serif`)

**Character:** Three voices with non-overlapping jobs. Be Vietnam Pro handles all Vietnamese
interface language and carries the Vietnamese subset properly. JetBrains Mono is not
decorative here — it is the machine's typewriter, and every number that could be compared to
another number is set in it with `tabular-nums`. Source Serif 4 appears only where a human
wrote prose for another human to read closely: the task prompt, the essay, and the AI's
sentence-level rewrite suggestions.

### Hierarchy
- **Display** (700, `clamp(2.4rem, 6vw, 4rem)`, 1.02, -0.035em): the public entry page's one headline, split across two lines that hold the machine/teacher contrast in colour.
- **Figure-monumental** (mono 700, `clamp(3.4rem, 8vw, 4.6rem)`, 0.82, -0.05em): the overall band on the marking rail. The largest object on the screen; one per sheet.
- **Headline** (700, `clamp(1.45rem, 3vw, 2rem)`, 1.15, -0.022em): page titles, balanced wrap.
- **Title** (600, 1.05rem, -0.01em): section heads above a hairline rule; blank-state titles.
- **Body** (400, 16px, 1.55): all interface prose. Secondary prose caps at 46–62ch.
- **Specimen** (serif 400, 1.05rem, 1.72, max 68ch): the essay itself, offset 1.6rem from mono line numbers punched down the outer edge; also the student's drafting textarea.
- **Figure** (mono 700, 1.18rem, tabular): criterion values and teacher fields. Machine figures use the same slot at 0.95rem weight 400 in `machine`.
- **Label** (mono 400, 0.62rem, 0.16em, uppercase): every micro-label, column head, ref, state chip, timeline title, and colophon line.

### Scale

The board is clerical and dense, so the ramp is fine-grained rather than geometric. These are
the only steps in the system; a new surface picks one, it does not interpolate.

`1.6` (commit preview figure) · `1.5` (strip overall) · `1.18` (criterion figure) · `1.05`
(section and blank titles, the essay specimen) · `1` (body, task prompt, bay count) · `0.95`
(strip name, subtitle, sentence marks) · `0.92` (fields, secondary prose) · `0.88` (controls,
notices, nav) · `0.84` (criterion name, adopt list, commit preview) · `0.78` (empty-bay text,
mark rationale) · `0.68` (refs, line numbers, deviations, timeline figures) · `0.62` (labels,
role chip) · `0.6` (field labels, colophon) · `0.58` (state chips) · `0.55` (criterion
abbreviations, strip band labels) — fifteen steps, all rem. Four clamps sit above the ladder: the display
headline, the monumental band, the page headline, and the landing closer.

### Named Rules
**The Fine Ladder Rule.** Fifteen rem steps plus four clamps is the whole ramp. Two steps
closer than 0.03rem apart are the same step — pick the documented one rather than adding a
neighbour.

**The Machine-Set Figure Rule.** Every number a reader might compare — band, word count, ref,
timestamp, deviation, count — is JetBrains Mono with `font-variant-numeric: tabular-nums`.
A band is always printed to one decimal, or an em dash when absent; a deviation is always
signed (`+0.5`, `−0.5`, `±0.0`).

**The Specimen Rule.** Source Serif 4 is reserved for text a person wrote: the prompt, the
essay, and sentence rewrites. The student's own drafting textarea is set in it too, at the
same `1.05rem` the specimen is read at — a student writes on the same material a teacher
reads. It never sets interface chrome.

**The Label-Not-Kicker Rule.** Uppercase mono micro-labels are column heads, field labels,
and state chips sitting *within* or *beside* their content. They are never stacked above a
headline as an eyebrow.

## Layout

A single centred column: `min(100%, 84rem)` for standard pages, `min(100%, 96rem)` for wide
board and sheet pages, with a `clamp(1rem, 3vw, 2.5rem)` gutter carried identically by the
masthead, main, and colophon so all three share one vertical edge.

The marking sheet is a two-column grid: the specimen at `minmax(0, 1fr)` and the marking rail
at `minmax(19rem, 23rem)`, gapped `clamp(1.5rem, 3.5vw, 3rem)`, with the rail sticky at
`top: 1rem`. Bays are an auto-fit grid at `minmax(15rem, 1fr)` with a 1px gap over a
`rack-edge` ground, so the gap itself reads as the gridline between bays. Racks and lists
stack their strips at 0.6rem.

Rhythm is clerical and tight: 0.1/0.35/0.6/0.9/1.25rem inside furniture, 2.75rem above a
section head. Section heads sit on a 1px `rule` with 0.4rem of lead-out — headings are
separated by a line, not by a void.

Two breakpoints, both in rem: at **60rem** the sheet collapses to one column and the rail
stops being sticky; at **44rem** strips stack into a single column with their end block
spread full width, the essay drops its line-number offset and the tractor-feed punch, and
the landing hero and steps collapse.

### Named Rules
**The One Edge Rule.** Masthead, main, and colophon all resolve to the same
`clamp(1rem, 3vw, 2.5rem)` inline padding and the same max width. Nothing on the page starts
at a different left edge.

## Elevation & Depth

Depth is physical, not atmospheric. There are exactly two soft shadows, both meaning "this
piece of paper is seated in a holder", and they are applied only to paper: strips, sheets,
prompts, rail blocks, and the landing demo strip. Everything else — bays, racks, notices,
commit blocks, fields — is flat and separated by a 1px border or a rule. There is no ambient
elevation, no blur-for-depth, and no z-layered scrim.

Pressables carry a different device: a hard 2px under-edge with no blur that collapses to 0
on `:active` while the control translates down 2px. That is the thickness of a key being
pressed, not a drop shadow; it exists only on controls that can be pressed.

### Shadow Vocabulary
- **Seat** (`box-shadow: 0 1px 0 var(--rack-edge), 0 10px 18px -14px rgb(42 39 36 / 0.45)`): paper at rest in its holder.
- **Seat Lift** (`box-shadow: 0 2px 0 var(--rack-edge), 0 22px 34px -22px rgb(42 39 36 / 0.5)`): paper lifted — hover on an interactive strip, paired with `translateY(-2px)`.
- **Press Edge** (`box-shadow: 0 2px 0 #1c1a18` on the primary press, `0 2px 0 var(--rack-edge)` on the quiet press): the key's own thickness; goes to `0 0 0` on `:active`.
- **Seated Inset** (`box-shadow: inset 0 0 0 1px var(--board-deep)`): the under-review strip, pressed one step further into its holder.

### Named Rules
**The Paper-Only Shadow Rule.** Seat and Seat Lift belong to stock. If an element is not
paper, it gets a border, a rule, or a tonal step — never a shadow.

**The Press-Collapse Rule.** A hard offset edge is only ever the thickness of a pressable
control and must collapse on `:active`. A hard offset that never collapses is decoration and
does not belong in this world.

## Shapes

Every corner in the system is square: `border-radius: 0`, including form controls and the
scrollbar thumb. Form language comes from edges, not corners.

The recurring silhouettes are all drawn from the board's own hardware:
- **The holder clip** — a 0.55rem strip bleeding off the left edge of every strip and mark, filled with a horizontal rib (`rgb(255 255 255 / 0.28)` at 2px on 5px) over the state colour, and closed with a 1px dark right edge. This is the state carrier.
- **The tractor-feed punch** — a repeating radial gradient in `board` down the outer edge of the essay sheet at a 1.3rem pitch. Dropped below 44rem.
- **The hatch** — 135° at 7/8px for waiting work, 45° at 9/18px in `alert-wash` for failed work. Hatching is the physical half of a state, always paired with its label.
- **The rule-through** — a 2px `orange-deep` bar drawn across a machine figure at 52% height, animated from `scaleX(0)`.
- **The stamp** — a 2px-bordered uppercase mono block rotated `-2.5deg`, landing via `stamp-press`.
- **The empty-holder field** — 1px verticals at a 2.4rem pitch, used as the landing closer's ground.

### Named Rules
**The Square Corner Rule.** Nothing in this system is rounded. A radius is a card tell, and
there are no cards here.

## Components

### Buttons
- **Shape:** square (0 radius), 1px border, no radius exceptions.
- **Primary ("Press"):** `ink` ground, `#f8f7f4` text, `#1c1a18` border, Press Edge under-shadow, 0.55rem/1.1rem padding, 0.88rem/600 label. Never orange.
- **Hover / Focus:** ground lifts to `#3b3733` over 0.16s `--ease-press`; focus is the global 2px `ink` outline at 2px offset.
- **Active:** `translateY(2px)` with the Press Edge collapsed to zero over 0.12s.
- **Disabled:** `rack-edge` ground, `rule-strong` border, `ink-quiet` text, no shadow, `not-allowed`.
- **Quiet:** `stock` ground, `rule-strong` border, `ink` text, `rack-edge` press edge; border darkens to `ink-quiet` on hover. Used for save, withdraw, and secondary entry actions.

### Cards / Containers
There are no cards. Content sits on one of three grounds: **bay** (`rack`, 1px gridline gaps,
0.75/0.85/1rem padding, dashed `rack-edge` head rule, `inset 0 3px 0 ink-quiet` plus a tonal
gradient when it is the current bay); **rail block** (`stock`, 1px `stock-edge`, Seat shadow,
1rem/1.1rem padding, head on a `rule` hairline); or bare board with a section rule above it.

### Inputs / Fields
- **Text field:** `stock` ground, 1px `rule-strong`, 0 radius, 0.6rem/0.7rem padding, vertical resize only; border darkens to `ink-quiet` on hover, and focus adds a 2px `ink` outline at 1px offset plus an `ink` border.
- **Criterion field (the teacher's hand):** transparent ground, no border except a 2px `orange` underline, mono 1.18rem/700 in `orange-deep`, right-aligned, spinners stripped. Hover and focus fill with `orange-wash`; focus outlines in `orange-deep`.
- **Refused (out of band):** an out-of-band figure turns the field `alert` on `alert-wash` with an `alert` underline and `aria-invalid`. The figure stays on screen and is refused rather than cleared or corrected; the row's deviation column prints nothing instead of a nonsense delta, an alert notice names the offending criterion in Vietnamese, both the save and sign presses disable, and the commit block's preview refuses to render a student sheet at all while any figure is out of band. `isBand` in `lib/format.ts` (0–9 in steps of 0.5) is the single guard, mirroring the server's.
- **Adopt box:** a 1.05rem square with an inset top highlight; checked renders a rotated 38° orange-deep mark via `stamp-press` — the tick is stamped, not drawn.
- **Placeholders:** `ink-quiet` at full opacity.

### Navigation
Masthead only: a `board-deep`→`board` gradient band closed by a 2px `rule-strong` bottom rule,
carrying the orange wordmark raster at 1.55rem height, an optional bordered mono role chip,
and right-aligned nav links. Links are 0.88rem/500 `ink-soft` with a transparent 2px bottom
border that fills `ink-quiet` on hover and `ink` when active; the sign-out control is a
`<button>` styled identically to a link. The colophon mirrors the masthead's edges in 0.6rem
uppercase mono on `board-deep`. There is no sidebar rail.

### Strip (signature component)
A submission seated in a holder: `stock` paper, 1px `stock-edge`, Seat shadow, a
`7.5rem | 1fr | auto` grid, and the holder clip bleeding off its left edge. It seats in with
`strip-seat` (0.3s, translateY from -8px with the shadow relaxing from Seat Lift to Seat).
Interactive strips lift 2px on hover and sit back flat on `:active`.

State treatments, each always accompanied by its uppercase mono label:
- **Waiting** (submitted / queued / scoring): `rule-strong` holder + 135° hatch.
- **Scored:** `ink-quiet` holder, clean stock.
- **Under review:** `ink` holder + inset seated ring.
- **Signed:** `cleared` holder + a left-to-right `cleared-wash`→`stock` wash; the label turns `cleared` with a `cleared` underline.
- **Failed:** `alert` holder + 45° `alert-wash` hatch; the label turns `alert`. Teacher-side material only — student surfaces pass the waiting treatment instead.

Bands print on the strip in `machine` grey; the overall figure is 1.5rem mono, dropping to
weight 500 `machine` while it is still the machine's number.

### Marking rail (signature component)
The right third of the sheet: a sticky stack of rail blocks holding the monumental overall
band, the four criterion rows, the feedback fields, the commit block, and the timeline. The
overall figure sits in `orange-deep` once the teacher owns it and in `machine` while it is
still the AI's, with the AI's figure struck beside it and the signed deviation printed below.

Criterion rows are a `1fr | 3.1rem | 4.2rem | 2.6rem` grid on a dotted `rule` separator:
machine figure, teacher field, deviation. Deviations read `cleared` when up and `alert` when
down, and always carry their sign. On a signed sheet the machine and deviation columns are
removed rather than printed empty.

### Commit block (signature component)
The visible threshold before signing: a 2px `orange-deep` border on `orange-wash`, an
uppercase mono head in `orange-ink`, the adopt list, then a `stock` preview panel showing the
exact sheet the student will read — band figure, criteria, summary, adopted suggestions —
followed by the internal note field and the quiet/primary action pair. Signing runs
`stamp-press`: the stamp lands from `scale(1.5) rotate(-9deg)` and settles at
`rotate(-2.5deg)` over 0.4s on `--ease-press`.

### Notices and blanks
Notices are 1px-bordered `stock` bars, recoloured to `alert-wash`/`#7d2318` or
`#f1f7ea`/`#33571f`, with `role="alert"` on the alert tone. Blank states centre a mascot
raster at `clamp(7rem, 16vw, 10rem)` with an empty `alt`, a 1.05rem/600 title, and a 44ch
line of explanation. The waiting rack is four 3.4rem skeleton strips sweeping a
100°/300% `strip-wait` gradient under a live-region label.

### Named Rules
**The Physical State Rule.** Every strip and every field state carries a physical treatment
*and* a text label. Adding a new state means inventing its material — a holder value, a
hatch, a seat depth, a stamp — not picking a new hue.

**The Mascot Rule.** The four assignment mascots and the 404 raster appear only where the
board is empty or broken. They never sit beside working content and never carry meaning
(`alt=""`).

**The Refused Figure Rule.** A figure the system cannot accept is shown, marked, and refused —
never silently cleared, rounded, or allowed downstream. Refusal propagates: the deviation goes
blank, the actions disable, and the student preview refuses to render rather than previewing a
sheet that could never be signed.

**The Press and Seat Rule.** Motion is press and seat on `cubic-bezier(0.16, 1, 0.3, 1)`:
0.12s for presses, 0.16–0.18s for hover, 0.28–0.4s for stamps and rule-throughs, 0.3s for a
strip seating. Under `prefers-reduced-motion` everything drops to 0.001ms.

## Do's and Don'ts

### Do:
- **Do** keep orange to the marking rail, the teacher's own marks, and the logo; the board's own furniture is never orange.
- **Do** give every new state a physical treatment *and* an uppercase mono label — holder colour value, hatching, seat depth, or a stamp.
- **Do** set every comparable number in JetBrains Mono with `tabular-nums`, bands to one decimal and deviations signed.
- **Do** rule the machine's figure through and leave it legible; append-only history must be visible, not described.
- **Do** reserve Source Serif 4 for text a person wrote — the prompt, the essay, and sentence rewrites.
- **Do** reach for a 1px `rule` or a tonal step to separate content; only paper gets Seat or Seat Lift.
- **Do** keep the overall band the largest object on a marking sheet, one per sheet.
- **Do** hold masthead, main, and colophon on the same max width and `clamp(1rem, 3vw, 2.5rem)` gutter.
- **Do** show mascot rasters only on empty, broken, or 404 surfaces, with `alt=""`.
- **Do** keep a refused figure on screen in `alert` on `alert-wash`, blank its deviation, disable the actions, and refuse to render the student preview until it is valid.
- **Do** drop an accent to its wash ink (`orange-ink`, `alert-ink`, `cleared-ink`) whenever it is set as text on its own wash.
- **Do** pick a step off the documented ladder; never interpolate a new one within 0.03rem of an existing step.

### Don't:
- **Don't** round anything. Every radius in this system is 0.
- **Don't** build cards, coloured status pills, score donuts, progress rings, streaks, or confetti.
- **Don't** signal a state with colour alone, and don't delete a machine figure to show it was overruled.
- **Don't** put a hard offset shadow on anything that cannot be pressed, and don't let one survive `:active`.
- **Don't** stack an uppercase mono label above a headline as an eyebrow or kicker; labels belong inside or beside their content.
- **Don't** show a student the failed strip's alert hatch, the machine's draft, or any internal note.
- **Don't** add a sidebar navigation rail; the masthead is the only navigation.
- **Don't** set interface chrome in the serif, or Vietnamese prose in the mono.
- **Don't** use `press-ink`, `press-hover`, or `press-label` anywhere but the primary press, or `clip-rib`/`clip-edge`/`board-rib` as anything but material.
- **Don't** clear, round, or quietly accept a figure outside 0–9 in steps of 0.5.
