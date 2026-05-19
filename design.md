# Teeify dashboard design system (for CLI auth webserver)

Hand this to the CLI team so their local auth page matches the control plane. The closest in-repo reference is **`/cli/auth`** (`src/app/cli/auth/page.tsx`), which already follows these rules.

---

## Overall look & feel

- **Mode:** Dark only (`html` has `class="dark"`).
- **Vibe:** High-end infra / devtool — near-black zinc base, glassy cards, thin white borders at low opacity, cyan + neon-green accents with soft glows.
- **Density:** Comfortable padding, `rounded-xl` / `rounded-2xl`, subtle rings and backdrop blur on elevated surfaces.
- **Motion (optional):** Light scale on hover/tap (≈1.02 / 0.98); not required for a minimal static CLI page.

---

## Color palette

### Brand accents (use sparingly for CTAs, links, icons, glows)

| Role | Hex | Usage |
|------|-----|--------|
| **Accent cyan** | `#00F0FF` | Primary CTA background, logo dot, icons, link hover, hero glow |
| **Accent green** | `#39FF14` | Primary CTA hover, secondary glow, “live” indicators on marketing |
| **Terminal green** | `#39FF14` | Pulsing “online” dot on network status (same as accent green) |

CSS variables in `globals.css`:

```css
--background: #0a0a0a;
--foreground: #ededed;
--accent-cyan: #00f0ff;
--accent-green: #39ff14;
```

### Neutrals (Tailwind zinc — main UI)

| Token | Typical use |
|-------|-------------|
| `zinc-950` | Page background (`bg-zinc-950`) |
| `zinc-900` | Cards, sidebar, inputs (`bg-zinc-900/50`, `/60`, `/80`) |
| `zinc-800` | Borders, code blocks, table dividers |
| `zinc-700` | Secondary borders (e.g. sign-out) |
| `zinc-600` | Muted labels, footer hints |
| `zinc-500` | Body secondary, section labels |
| `zinc-400` | Descriptions, nav inactive |
| `zinc-300` | Secondary text, ghost buttons |
| `zinc-200` | Nav hover text |
| `zinc-100` | Default body text on dark |
| `zinc-50` | Headings |

### Borders & overlays

- Standard border: `border-white/10` or `border-zinc-800`
- Softer card ring: `ring-1 ring-white/5` or `ring-white/10`
- Inset highlight on premium cards: `ring-inset ring-white/[0.06]`
- Header / navbar: `bg-zinc-950/80 backdrop-blur-md` + `border-b border-white/10`

### Semantic / status (dashboard + network UI)

| State | Colors |
|-------|--------|
| **Success / fresh / online** | `emerald-400`, `emerald-500` (badges); live dot `#39FF14` with glow |
| **Warning / stale** | `amber-400` |
| **Error / offline** | `red-400` / `red-500` at ~25–40% border opacity |
| **Info accent** | Cyan `#00F0FF` |

### Gradient text (marketing only; optional on CLI)

```css
background: linear-gradient(90deg, #00f0ff, #39ff14);
-webkit-background-clip: text;
color: transparent;
```

---

## Typography

| Element | Font | Weight / style |
|---------|------|----------------|
| **UI (default)** | **Geist Sans** (`font-sans`) | `antialiased` on `html` |
| **Code / API keys / ports** | **Geist Mono** (`font-mono`) | `text-xs`–`text-sm`, often `tabular-nums` for numbers |
| **Fallback stack** | `system-ui, sans-serif` | Via `body` in `globals.css` |

### Type scale (dashboard patterns)

| Role | Classes |
|------|---------|
| Page title | `text-2xl`–`text-3xl` `font-semibold` `tracking-tight` `text-zinc-50` |
| Card title | `text-lg` `font-semibold` `text-zinc-50` |
| Body | `text-sm` `leading-relaxed` `text-zinc-400` (sometimes `text-base` on marketing) |
| Section label | `text-xs` `font-medium` `uppercase` `tracking-wide` `text-zinc-500` |
| Tiny meta | `text-[10px]` `font-semibold` `uppercase` `tracking-wider` `text-zinc-600` |
| Nav links | `text-sm` `font-medium` |

Use **`text-balance`** on headings and **`text-pretty`** on paragraphs where supported.

---

## Layout & spacing

- **Content width:** `max-w-4xl` (settings/overview), `max-w-md`–`max-w-lg` for centered auth-style flows.
- **Page padding:** `px-4 py-10`–`py-12`, `sm:px-6`.
- **Dashboard shell:** Fixed sidebar `w-56` (`md:left-56` for main glow offset); main content scrolls beside it.
- **Card padding:** `p-5`–`p-8`, often `sm:p-6` / `sm:p-12` on hero cards.
- **Vertical rhythm:** `mt-2`–`mt-10` between sections; button stacks `gap-3`.

---

## Components (copy-paste patterns)

### Page background

```html
<!-- Base -->
background: #09090b; /* zinc-950 */
color: #f4f4f5; /* zinc-100 */

<!-- Optional ambient glow (CLI auth uses ~12% opacity) -->
background-image:
  radial-gradient(ellipse 70% 50% at 50% 0%, #00F0FF, transparent),
  radial-gradient(ellipse 50% 40% at 80% 60%, rgba(57, 255, 20, 0.15), transparent);
```

### Primary button (Authorize / Dashboard)

- Default: `bg-[#00F0FF]` `text-zinc-950` `font-bold` `rounded-xl` `h-12` `px-8`
- Shadow: `box-shadow: 0 0 28px rgba(0, 240, 255, 0.35)`
- Hover: `background: #39FF14`, shadow `0 0 28px rgba(57, 255, 20, 0.4)`

### Secondary / OAuth button (GitHub)

- `rounded-xl` `h-12` `border border-white/15` `bg-zinc-900/80` `text-zinc-100` `font-semibold`
- `ring-1 ring-white/10`
- Hover: `border-color` cyan ~40% opacity, cyan glow shadow

### Ghost / outline nav (Verify)

- `rounded-full` `border border-white/20` `bg-transparent` `text-zinc-300`
- Hover: `bg-white/4` `text-zinc-100`

### Card (settings, CLI authorize panel)

- `rounded-2xl` `border border-white/10` `bg-zinc-900/50`
- `ring-1 ring-white/5` or `ring-white/10`
- Optional: `backdrop-blur-sm`, cyan shadow `0 0 60px -24px rgba(0, 240, 255, 0.2)`

### Icon badge (logo / terminal icon)

- Container: `56px` square, `rounded-2xl`, `border border-white/10`, `bg-zinc-900/60`
- Icon color: `#00F0FF`, stroke ~1.75
- Glow: `box-shadow: 0 0 40px -8px rgba(0, 240, 255, 0.4)`

### Brand mark (header)

- Wordmark: `font-semibold` / `font-bold`, `text-zinc-50` or `text-zinc-300`
- Dot: `8px` circle, `#00F0FF`, `box-shadow: 0 0 12px #00F0FF`

### Inline code

- `font-mono` `text-xs` `bg-zinc-800` `text-zinc-300` `rounded` `px-1.5 py-0.5`

### Account info block (CLI auth)

- Inner panel: `rounded-xl` `border border-white/10` `bg-zinc-950/80` `px-4 py-3.5`
- Label: uppercase micro text `text-zinc-500`
- Name: `font-medium text-zinc-100`
- Email: `text-sm text-zinc-500`

---

## Sidebar-specific (if they build a multi-step flow)

- Background: `bg-zinc-950`, `border-r border-zinc-800`
- Active nav: `bg-white/5` `text-zinc-100` `ring-1 ring-white/10`
- Inactive nav: `text-zinc-400`, hover `bg-white/5` `text-zinc-200`

---

## Icons

- Library: **Lucide** (stroke icons, ~1.75 stroke on feature icons).
- Common: `Terminal`, `Sparkles`, `LayoutDashboard`, `Shield`, `Activity`, `Loader2` for spinners.

---

## What to mirror for CLI localhost auth

Minimum set for parity with `/cli/auth`:

1. Full viewport `zinc-950` background + subtle cyan/green radial glows.
2. Centered `max-w-md` card with white/10 border and zinc-900/50 fill.
3. Title + subtitle hierarchy (`zinc-50` / `zinc-400`).
4. Account block showing name/email.
5. Cyan primary **Authorize** button with green hover.
6. GitHub secondary button if login is needed (same as dashboard welcome).
7. Geist Sans + Geist Mono (or close substitutes: **Inter** + **JetBrains Mono** if fonts can’t be loaded).

Reference implementation in this repo: `src/app/cli/auth/page.tsx` and `src/app/cli/auth/_components/*`.

---

## Quick CSS variables block (for non-Tailwind CLI server)

```css
:root {
  --teeify-bg: #09090b;
  --teeify-fg: #f4f4f5;
  --teeify-muted: #a1a1aa;
  --teeify-card: rgba(24, 24, 27, 0.5);
  --teeify-border: rgba(255, 255, 255, 0.1);
  --teeify-cyan: #00f0ff;
  --teeify-green: #39ff14;
  --teeify-cyan-glow: 0 0 28px rgba(0, 240, 255, 0.35);
  --teeify-green-glow: 0 0 28px rgba(57, 255, 20, 0.4);
  --font-sans: "Geist", "Inter", system-ui, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
}
```

That should be enough for the CLI agent to reproduce the same “Teeify control plane” look on their auth webserver without reading the Next.js codebase.