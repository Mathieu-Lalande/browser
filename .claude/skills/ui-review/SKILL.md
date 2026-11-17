---
name: ui-review
description: Audit and polish the browser's desktop interface (Svelte chrome, settings, internal browser:// pages, overlay popovers) for spacing, alignment, hierarchy, consistency and intuitiveness, then fix what it finds. Use when the user asks to review, clean up, polish or make an interface "beautiful/intuitive", reports padding or alignment bugs, or before shipping a new panel or settings section.
---

# UI review — Browser

Goal: an interface that feels obvious on first use and calm to look at. Every screen should
answer "what is this, what can I do, what happens next" without reading a manual.

Work in this order: **find → rank → fix → verify**. Fix in the shared primitive when the bug is
there (one fix, every screen benefits), locally only when it is truly local.

## 1. Scope

Ask (or infer from the request) which surface: a settings section, a `browser://` page, the
sidebar, the address bar, an overlay popover, or "everything". For "everything", sweep in this
order: settings → internal pages → sidebar/window bar → overlay popovers → start page.

Files: `src/renderer/src/components/**`, `src/renderer/src/overlay/**`, primitives in
`components/ui/`, scales in `styles/global.css`, panel layout in `styles/kit.css`.

## 2. Find — mechanical checks first

Run these, they find most padding bugs before any screenshot:

```bash
cd src/renderer/src
# Off-scale spacing (scale is 4/8/12/16/24/32 = --space-1..6). 1–2px hairlines are fine.
grep -rnE "(padding|margin|gap)[^;]*\b(3|5|6|7|9|10|11|13|14|15|18|20|22)px" components overlay --include=*.svelte
# Hard-coded radii / font sizes instead of --radius-sm/md/lg and --text-xs..xl
grep -rnE "border-radius: ?[0-9]+px|font-size: ?[0-9]+px" components overlay --include=*.svelte
# Hand-rolled lists, search boxes, buttons that duplicate a primitive
grep -rnE "class=\"(search|list|bookmarks|devices)\"|<button class=\"(secondary|primary|action)\"" components --include=*.svelte
```

Then read the component and look for these known traps:

- **`display: block` containers have no `gap`.** Siblings touch (the "Add" button glued to
  its list). `Row stacked` already spaces its children; any other block wrapper needs a gap or
  `* + *` margin.
- **Horizontal inset drift.** Every line inside a settings card starts at `--space-4` (16px,
  `Row`'s padding). Any header, help text, list or toolbar in the same card must use the same
  inset, or edges zig-zag.
- **Nested radii.** Inner radius + padding = outer radius
  (`Card.list`: `calc(var(--radius-md) + var(--space-1))` around `ListRow`'s `--radius-md`).
- **Two-line rows.** Title + detail in a `ListRow`: `.main` needs `min-width: 0` and the detail
  `text-overflow: ellipsis`, the row `align="start"` if the actions should top-align.
- **Fixed heights with wrapping text** (`height: 34px` on something holding a label that can
  wrap in English or at 200% zoom): use `min-height`.
- **Hover-only affordances** with no focus equivalent (`:hover` without `:focus-visible` /
  `:focus-within`).
- **Container queries.** Settings column narrows at 520px (`@container settings`): check the
  row still reads at that width and nothing overflows horizontally.

## 3. Find — look at it

Static review misses rhythm and hierarchy. Capture the screen:

- `SCREENSHOTS=1 xvfb-run -a npx playwright test tests/e2e/screenshots.spec.ts` (see
  `docs/INSTALL.md`), or the `run` skill to launch the app and screenshot the surface.
- Check light **and** dark, French **and** English (English strings are often longer),
  compact sidebar, a narrow split pane, and `prefers-reduced-motion`.

Judge each screen against:

| Axis | Question |
|---|---|
| Hierarchy | One clear primary action per view? Labels > hints > metadata in weight and color? |
| Rhythm | Same vertical spacing between equivalent things? Groups separated more than items? |
| Alignment | Do left edges line up across header, rows, lists and buttons of a card? |
| Consistency | Same thing looks the same everywhere (lists, search fields, empty states, destructive actions)? |
| Intuitiveness | Can a first-time user guess what each control does from its label? Is the default state useful? |
| Feedback | Every action shows a result (state change, toast, inline message) within 100 ms? |
| Empty / error / loading | Each has a designed state (`EmptyState`, inline notice), never a blank area? |
| Accessibility | Hit target ≥ `--hit-min`, visible focus ring, labels on icon buttons, contrast ≥ 4.5:1 for text? |
| Copy | Short, verb-first buttons ("Ajouter une adresse"), no jargon, no duplicated hint/label text. |

## 4. Rank

Report as a short table: **surface · problem · why it hurts · fix · effort (S/M/L)**.
Order: broken (overlap, clipping, unreachable) → inconsistent (spacing, primitives) →
polish (hierarchy, copy, motion). Do not pad the list with taste-only nits.

## 5. Fix — house rules (from CLAUDE.md)

- Only tokens: `--space-1…6`, `--radius-sm/md/lg/pill`, `--text-xs…xl`, `--hit-min`,
  `--motion-fast/base`, theme colors (`--text`, `--text-muted`, `--text-faint`, `--border`,
  `--surface`, `--surface-hover`, `--accent`, `--danger`…). No component-specific numbers
  except 1–2px hairlines and fixed icon/control sizes.
- Prefer the primitives in `components/ui/` (`Card`, `ListRow`, `Row`, `Button`, `IconButton`,
  `SearchField`, `EmptyState`, `ConfirmButton`, `Menu`, `Toggle`, `Segmented`, `Page`,
  `use:dismiss`). Replacing a hand-rolled list/search box by the primitive is a fix, not a refactor.
- A primitive change affects every screen: grep its usages, check them, and say so.
- No hard-coded text: `t("zone.clé")`, both `fr.ts` and `en.ts`.
- Lucide icons only (`Icon`), no emoji.
- Never draw over a page (`WebContentsView` is native): shrink the viewport, hide the view, or
  use the overlay layer (ADR-010).
- Keep tests' hooks: `row` class on `ListRow`, `data-testid`, `data-setting`/`data-row` anchors.

## 6. Verify

`npm run typecheck && npm run check:i18n && npm test`, then the e2e specs touching the surface
(`npx playwright test tests/e2e/<surface>*.spec.ts`), and a before/after screenshot of each fixed
screen. State plainly what was checked visually and what was not.
