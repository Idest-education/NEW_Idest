# Assets pending creation

The app works without any of these files. Io itself is drawn in code (`components/io.tsx`), so these are
optional **scene illustrations** that put Io in a small moment. When a file is in place, tell Claude and it
will wire it in (the "Used by" column says where).

## Brand reference (paste into every prompt)

> **Character, "Io":** a soft, slightly lopsided round blob, a little wider than tall, sitting on the ground.
> Cobalt blue `#2F5BFF`, flat fill, **no outline, no arms, no legs, no hat, no accessories**. Two small
> vertical oval eyes in near-black `#1A1B2E`, each with one tiny white highlight; the left eye is slightly
> bigger and higher than the right. A small, slightly crooked smile. Pale pink oval cheeks `#FF7AB6` at about
> 75% opacity, the left cheek a bit larger. One soft white curved shine near the top left. A faint soft
> shadow ellipse under the body. Cute, calm, a little imperfect, hand-made, not glossy 3D.
>
> **Style:** flat vector illustration, simple shapes, rounded and soft, generous empty space, no gradients
> except a very gentle shine, no text, no letters, no logos, no humans.
> **Palette only:** cobalt `#2F5BFF`, light periwinkle `#8AA4FF`, highlighter yellow `#FFE14D`, coral
> `#E5484D`, green `#1E9E5A`, bubblegum pink `#FF7AB6`, paper white `#FFFFFF`, ink `#1A1B2E`.
> **Background:** transparent. It must read well on both warm paper `#FFFBF3` and near-black `#13141C`, so
> avoid large ink-colored areas and avoid white halos around edges.

If the generator drifts (adds arms, a mouth full of teeth, outlines, a 3D render), regenerate. Io should
look like the moods on the palette page: https://claude.ai/artifact/1A1sgHY4u2WV22DkQU8hwq

## Export

- PNG with alpha (or WebP with alpha), sRGB, **2× the size in the table** (e.g. 1280 × 960 for a 640 × 480 slot).
- Trim to the illustration with ~5% empty margin. Keep Io roughly centered and facing the viewer.
- File names are lowercase with dashes, exactly as in the table.

## Files

| # | File name | Place it at | Slot size | Used by |
| --- | --- | --- | --- | --- |
| 1 | `empty-batches.webp` | `apps/web/public/illustrations/` | 640 × 480 | Batches page with no batches yet (`components/batches-view.tsx`) |
| 2 | `empty-history.webp` | `apps/web/public/illustrations/` | 640 × 480 | History page with nothing graded (`components/history-view.tsx`) |
| 3 | `not-found.webp` | `apps/web/public/illustrations/` | 640 × 480 | 404 page (`app/not-found.tsx`) |
| 4 | `grading-failed.webp` | `apps/web/public/illustrations/` | 480 × 360 | Result page when scoring failed (`components/result-view.tsx`) |
| 5 | `welcome-io.webp` | `apps/web/public/illustrations/` | 480 × 360 | Signed-out sidebar card and sign-in page (`components/shell.tsx`, `app/sign-in`) |
| 6 | `opengraph-image.png` | `apps/web/app/` | 1200 × 630 (export at 1×) | Link previews. Replaces the generated `app/opengraph-image.tsx`; delete that file when you add this one |

## Prompts

Start every prompt with the **Brand reference** block above, then add the scene:

1. **empty-batches**: Io sits happily next to a tidy stack of loose essay sheets. Three sheets float up from the
   stack in a gentle arc, one with a small yellow highlighter stripe and one with a small green tick. Io looks
   up at them, eager. Feeling: "ready to grade the whole class".

2. **empty-history**: Io rests beside a single blank sheet of lined paper on the ground. A short cobalt pencil
   lies next to the sheet (the pencil is on the ground, Io does not hold it). Io looks at the viewer with a
   small hopeful smile. Feeling: "nothing here yet, let's start".

3. **not-found**: Io sits in empty space, head tilted to one side, looking around curiously. A dotted periwinkle
   path leads in from the left and stops just before Io. A small bubblegum-pink question mark floats above
   Io's head. Feeling: friendly and puzzled, not alarming.

4. **grading-failed**: Io has a tiny worried look (eyebrows slightly raised) and one small periwinkle sweat drop.
   Beside Io, an essay sheet rests safely inside an open yellow folder. A small coral circular arrow (a
   "try again" symbol) floats above the folder. Feeling: "your work is safe, let's try again".

5. **welcome-io**: Io peeks over the top edge of a fanned stack of three essay sheets, cheeks extra pink, eyes
   bright. One sheet shows a big yellow highlighter stroke. Feeling: warm hello, inviting a teacher to sign in.

6. **opengraph-image** (it has text, so make it in a design tool, not an image model):
   - Background warm paper `#FFFBF3`. Padding 80px.
   - Top left: the logomark (cobalt triangle, bar and circle on one baseline, each 64px tall), then the
     lowercase wordmark **aio** in Plus Jakarta Sans ExtraBold, 120px, letter spacing -6px, color `#1A1B2E`.
   - Bottom left: "Grade IELTS Writing in a minute." in Plus Jakarta Sans Bold, 76px, `#1A1B2E`. Under it,
     "Free · Task 1 & 2 · Bulk grading for teachers" at 34px, `#5A5870`.
   - Right side: Io from prompt 5 (or a plain Io), about 380px tall, sitting on the bottom padding line.
   - Optional: one highlighter-yellow `#FFE14D` stroke behind the word "minute".
