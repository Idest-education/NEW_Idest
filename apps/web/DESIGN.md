# AIO design system

AIO ("Ay-Ai-Oh", all-in-one) is a free IELTS Writing grader. The look is a teacher's pencil case: warm
paper, a blue pen, a highlighter, a red pen, a green tick, and Io, a small blob who does the reading.

## Brand

- **Wordmark:** lowercase `aio`, Plus Jakarta Sans 800, letter spacing -0.04em (`components/logo.tsx`).
- **Logomark:** a triangle, a bar and a circle on one baseline (A, I, O), in `--accent`.
- **Mascot, Io:** the logo's circle come alive as a soft, lopsided blob (`components/io.tsx`). See below.
- **App icons:** Io's face (`app/icon.svg`, `app/apple-icon.png`).
- **OG image:** `app/opengraph-image.png` (1200 × 630), alt text in `opengraph-image.alt.txt`.
- **Metadata:** title template `%s · AIO`, default `AIO — Free IELTS Writing grader` (`app/layout.tsx`).

## Tone of voice

1. **Say what happens next.** Every status and every error ends with something the user can do.
   - Do: "Io usually takes under a minute. You can leave this page; the link keeps working."
   - Don't: "Processing request…"
2. **Plain words; IELTS words only.** Band, criteria, Task 1 are fine. Queue, extraction, JSON are not.
   - Do: "We couldn't read those photos. Try sharper, well-lit photos."
   - Don't: "Extraction failed (OCR error)."
3. **Playful about the experience, never silly about the score.** Io can be sleepy or trip over a failure;
   a band score is always stated plainly, with its IELTS descriptor.
   - Do: "Io tripped over this one. Your essay is safe." / "7.0 · Good user"
   - Don't: "Oopsie!! 🙈" / "Only 5.5, yikes."

## Tokens (`app/globals.css`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#fffbf3` | `#13141c` | page (warm paper / navy-black) |
| `--surface` / `--surface-2` | `#ffffff` / `#f4eee2` | `#1c1d29` / `#262838` | cards, inputs / sidebar, quiet fills |
| `--line` / `--line-strong` | `#e9e1d2` / `#d3c8b4` | `#2e3042` / `#46485e` | borders |
| `--text` / `--text-2` | `#1a1b2e` / `#5a5870` | `#f2f0ea` / `#a9a7bc` | text, secondary text |
| `--accent` | `#2f5bff` | `#8aa4ff` | blue pen: buttons, Io, focus |
| `--accent-text` | `#264be8` | `#8aa4ff` | links and accent text on tinted fills |
| `--mark` on `--mark-bg` | `#5c4400` on `#ffe14d` | `#ffe066` on `#3d3300` | highlighter: corrections, 5.5–6 bands |
| `--danger` on `--danger-bg` | `#c8323a` on `#fdecec` | `#ff8a8e` on `#3a1b1e` | red pen: errors, bands ≤ 5 |
| `--ok` on `--ok-bg` | `#146c3f` on `#e2f4e8` | `#5ee39a` on `#16301f` | green tick: finalized, 6.5–7 bands |
| `--pop` | `#ff7ab6` | `#ff9fcb` | eraser pink: Io's cheeks, sparkles |
| `--ink` | `#1a1b2e` | same | Io's eyes and lines |

Every text and background pair passes WCAG AA (≥ 4.5:1). The theme follows the system. The account menu can
set `data-theme="light|dark"` on `<html>`, stored in `localStorage["aio-theme"]`.

**Band tones** (`bandTone` in `lib/format.ts`; `.tone-*` text and `.tile-*` fills in globals): `low` ≤ 5,
`mid` 5.5–6, `good` 6.5–7, `great` ≥ 7.5. The number is always shown, so the color is never the only signal.
The overall band also shows its IELTS descriptor (`bandWord`, e.g. "Competent user").

**Type:** Plus Jakarta Sans for everything (`next/font/google`, `--font-jakarta`). Scale 12 / 14 / 16 / 18 / 22 /
28 / 40 / 64. Bands use `tabular-nums`. **Radius:** 10 (controls) and 16 (cards). Pills for buttons and chips.
**Spacing:** 4px grid.

**Icons:** Material Symbols Rounded from Google Fonts, through `<Icon name="…" />`. The stylesheet asks
only for the names in `ICON_NAMES` (`app/layout.tsx`), so add each new icon there in alphabetical order.

## Io

`<Io mood size label? boopable? />` (`components/io.tsx`, motion in `io.module.css`).

- **Shape:** a blob in `--accent` whose outline slowly morphs between three lopsided shapes (SVG `<animate>`).
  One eye a little bigger and higher, a crooked smile, uneven pink cheeks, a soft shine, a shadow.
  No outline, no limbs, no props beyond one tiny mood extra.
- **Moods and where they live:**

| Mood | Motion | Used on |
| --- | --- | --- |
| `idle` | slow breathing, double blink | home composer, sign-in prompts |
| `sleepy` | slower breathing, drifting z's | home composer after 10pm |
| `reading` | eyes scan left, pause, right | home while photos are transcribed |
| `scoring` | sway, three thinking dots | result page while queued or scoring |
| `celebrate` | squash, jump, stretch, land ×3, sparkles | result at 7.0+, batch fully graded |
| `oops` | small wobble, sweat drop | failed grading, failed transcription, load errors |
| `busy` | quick bounces, pages pop out | batch reading or grading, account setup |
| `lost` | head tilt, looking around, "?" | no-access pages |

- **Motion rules:** everything eases in and out (`cubic-bezier(.45, 0, .55, 1)`); squash and stretch from the base;
  celebrations play three times, then settle. `prefers-reduced-motion` stops all of it, including the morph.
- Io is decorative (`aria-hidden`) unless given a `label`. The words next to Io always carry the meaning.

**Illustrations** (`public/illustrations/`, transparent WebP, generated from `assets-pending-creation.md`):
`empty-batches`, `not-found`, `grading-failed`, `welcome-io`. They are shown with `next/image` at a fixed width
and work on both themes.

## Styling

CSS Modules + CSS custom properties: tokens are plain variables, themes are one selector, and no dependency
is needed. Shared primitives in `globals.css`: `.btn` (`-primary`, `-secondary`, `-ghost`, `-danger`, `-sm`,
`-icon`), `.input`, `.textarea`, `.select`, `.field`, `.label`, `.hint`, `.card`, `.chip` (`-accent`, `-ok`,
`-danger`, `-mark`), `.alert`, `.page`, `.page-head`, `.page-title`, `.row`, `.stack`, `.skeleton`,
`.sr-only`, `.num`, `.tone-*`, `.tile-*`. A component's layout lives in its own `*.module.css`. A module rule
must not set `color` or `background` on an element that also takes a `.tone-*` or `.tile-*` class, because the
module rule would win.

**Feedback:** short confirmations ("Draft saved", "Link copied", "Excel ready") are toasts (`useToast()`,
`components/toast.tsx`, announced through `role="status"`). Errors stay inline, next to what failed.

## Layout

- **Shell** (`components/shell.tsx`): a 272px sidebar on screens ≥ 900px, which can be collapsed. Below that it
  is a `<dialog>` drawer with focus trap and Escape. The sidebar holds New grading, teacher links, recent work
  grouped by date with colored bands, and the account menu. Signed-out visitors see a "Sign in for bulk
  grading" card.
- **Home**: Io, a greeting, one centered composer card. **Result**: a conversation, with the essay as the user's
  turn and Io's reply holding the assessment; the band counts up and the criteria rise in one by one.
  **Batches**: the same composer card; the detail page shows Io's mood next to the progress bar.
  **Review**: two panes from 1024px up (the form pane is sticky), stacked below that.

## Feedback layout (AI result shape: `comment`, `criteria.{key}.{comment, evidence, reasoning}`, `sentence_feedback`)

- **Sentence comments live on the essay** (`components/essay-text.tsx`): highlights show the comment in a
  pop-up on hover, focus or tap. Nothing repeats below. In review, a click edits the comment, and selecting
  any text offers "Add comment" (criterion, what's wrong, better version).
- **Result**: band and descriptor, the overall `comment` as the lead paragraph, then one card per criterion
  (band badge, comment, "Why this band"). Older results (`summary`, `strengths`, `improvements`) still render.
- **Review**: the four criteria sit in one 2 × 2 frame once the pane is 440px wide (container query), each with
  a −/+ band stepper, the AI band, "Use AI", a "Why?" native popover and a fixed 5-line comment box. The big
  band is the AI's until the teacher changes a band; then "AI → Your band" appears. Save draft / Finalize stay
  pinned, and leaving with unsaved changes asks first. There is no private note.

## Home

Signed in: Io, the greeting and the composer, nothing else. Signed out (`components/landing.tsx`): hero, the
working composer ("Try it now"), how it works, an example result, the teacher pitch and an FAQ. Pasting an
image into either composer attaches it as the Task 1 chart and switches to Task 1.

Lists (history, batches, tickets) show 15 per page (`Pager`, `pageOf`).

## Accessibility

Visible focus on every control (2px `--accent` outline). Menus use arrow keys, Home and End, and Escape returns
focus. Progress and toasts use `role="status"` / `aria-live="polite"`. Buttons press down slightly
(`scale(.96)`). `prefers-reduced-motion` turns off every animation. Layouts work from 360px.
