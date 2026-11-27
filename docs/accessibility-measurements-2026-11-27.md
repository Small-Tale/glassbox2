# Contrast and target-size measurements, 2026-11-27 (`GB2-6NVCBB`)

A measurement of the shipped review workbench, requested as R6 of the [UX evaluation](ux-evaluation-2026-11-27.md).
It changes nothing; it records numbers and files a ticket per measured failure.

## Method

- **Application.** The real built client served by the real host, in Chromium, against an isolated seeded repository.
- **Views.** A text diff with one open comment and the Inspector, and an image comparison, each in the light and
  dark color schemes at 1440 and 390 CSS pixels wide (8 scans, 23 to 55 text nodes and 38 to 43 controls each).
- **Text contrast.** For every visible text node: its computed color, composited over the effective background (the
  nearest opaque ancestor color with translucent layers blended), against WCAG 2.2 1.4.3: 4.5:1, or 3:1 for text of at
  least 24 px or 18.66 px bold. Disabled controls are recorded but exempt. Nothing had a gradient or image
  background, so every ratio was computable. Visually hidden accessible text (boxes of 1 px or less) is excluded.
- **Target size.** For every visible button, role button, tree item, link, input, select, tab, slider, checkbox,
  radio and disclosure summary: its box against WCAG 2.2 2.5.8 (24 by 24 CSS px, ignoring the spacing exception).
- **Transitions.** Kerf animates color changes, so each scan runs with transitions disabled and two frames after the
  color scheme changes. A first run that sampled mid-transition produced false failures (the same label read
  1.78, 2.57 and 4.04) and was discarded.
- **Not measured.** Non-text contrast (icon glyphs, borders, focus rings, 1.4.11), keyboard focus appearance,
  the narrow rails opened one by one, dialogs, and the desktop window. The second reviewer's focus-ring concern
  is therefore neither confirmed nor refuted here.

## Results

| Check                                             | Result                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text contrast, dark scheme, both widths and views | No failures. The lowest ratio is 5.51:1 (the "M" status badge at 11 px).                                                                                      |
| Text contrast, light scheme                       | Two failures, both 11 px, weight 650, color `rgb(98, 98, 103)` on the badge fill: 4.39:1 against 4.5:1.                                                       |
| Disabled controls                                 | No disabled text fell below its threshold.                                                                                                                    |
| Target size, below 24 px                          | None.                                                                                                                                                         |
| Smallest controls                                 | Filter Changed Files input 31 px high; the Focus image buttons, Change Source and the line comment button 33 px; changed-file rows 36 px; Find in Diff 40 px. |

The two light-scheme failures are the changed-file status badge letter ("M", accessible name "Modified") and the
category pill in the Inspector header ("Note"). Both are Kerf `Badge` text, so the color belongs to Kerf.

## What this says about the evaluation's claims

The second reviewer suspected small targets, 11 px labels and borderline dark-theme links. Measured: no control is
below 24 px, dark-theme text meets 4.5:1 throughout, and only the two light badge cases are below the threshold, by
0.11. Small badge text (11 px) is a legibility choice that WCAG does not fail on size alone.

## Filed

- `KF-M22BM6` (Kerf): the compact Badge text color has 4.39:1 contrast on its fill in the light scheme.
- `GB2-TB3D3R`: track the Kerf fix and re-measure the two cases after the upgrade that carries it.

## Re-measured on Kerf beta.139 (`GB2-TB3D3R`)

The same scan (8 views, same method) was re-run after the upgrade that carries `KF-M22BM6`. No text node is below its
threshold in either scheme: the lowest light-scheme ratio is now 4.60:1 (was 4.39:1), the dark-scheme minimum is
unchanged at 5.51:1, and no target is below 24 by 24 CSS pixels. Both former failures (the changed-file status letter
and the Inspector category pill) pass. No local override was needed.
