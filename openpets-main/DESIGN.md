# OpenPets Control Center: Design System & Engineering Manual

This document outlines the visual direction, component patterns, and front-end engineering guidelines for the OpenPets Control Center. It serves as a practical implementation guide for migrating existing views (Settings, Plugins, Integrations, Onboarding) and building new pages using a cohesive, high-fidelity tactile design system.

---

## 1. Visual Direction & Heritage

The OpenPets Control Center blends the nostalgic, playful charm of late-90s/early-2000s desktop pet managers with a modern, glassmorphic utility interface. 

- **The Core Tension**: Playful nostalgia meets crisp, modern desktop productivity.
- **Atmospheric Depth**: Instead of flat, sterile surfaces, interfaces leverage rich color gradients, subtle mesh backdrops, structured panels, and tactile control elements.
- **Physicality**: Interactive components feel physical. They have distinct borders, inset highlights, drop shadows, and visual feedback on click/press.

---

## 2. Backgrounds & Surface Treatments

Surfaces are layered to establish clear spatial hierarchy and keep the interface readable.

### Page Backdrop
- **Formula**: A radial ambient glow on top of a subtle linear gradient.
- **Implementation**:
  ```css
  background: radial-gradient(circle at 12% 8%, rgba(219, 234, 254, 0.9), transparent 24%),
              linear-gradient(180deg, #f8fbff 0%, #eff7ff 54%, #e9f3ff 100%);
  ```

### Glass Panels (`.glass` / `GlassCard`)
- Panels use semi-transparent white fills coupled with a distinct double-border look (using inset box shadows) to simulate thick, polished acrylic sheets.
- **Specifications**:
  - Background: `rgba(255, 255, 255, 0.76)`
  - Border: `1px solid rgba(126, 161, 210, 0.48)`
  - Inner Highlight: `inset 0 1px 0 rgba(255, 255, 255, 0.96)`
  - Shadow: `0 24px 60px rgba(61, 99, 160, 0.15)`
  - Blur: `backdrop-blur-xl`
  - Border Radius: `28px` (`rounded-[28px]`)

---

## 3. Page Shell, Layout & Grids

The desktop shell is designed to be self-contained, fitting exactly within the viewport height without scrolling the entire window.

- **Page Shell**: Max-width of `1160px` centered, utilizing a full-height flexbox column (`h-screen p-6`).
- **Hero Header**: A balanced layout placing title text and description on the left (`.hero-content`) and the wider brand artwork (`openpets.webp`) on the right (`.hero-logo-container`). Keep artwork large enough to feel intentional, use `object-contain`, and avoid rounded wrappers or distortion.
- **Layout Split**: A clean grid split, typically:
  - **Left Gallery/List Panel**: `1.25fr` — for browsing, searching, and filtering.
  - **Right Detail/Action Panel**: `0.75fr` — for contextual inspection and heavy operations.
- **Scroll Containers**: Sub-panels (like grids and lists) scroll internally (`overflow-y-auto`) with customized scrollbars so that headers, filters, and primary action bars remain pinned.

---

## 4. Typography & Tone

- **Font Family**: Refined sans-serif (e.g., `Inter`, `system-ui`) for maximum readability in body copy, labels, and metadata.
- **Display Typography**: Strong, characterful monospace or display-sans fonts (e.g., Lucida Console, geometric display fonts) for headers and uppercase labels to evoke retro desktop applications.
- **Typographic Hierarchy**:
  - **Hero Title**: `text-5xl font-black tracking-tight`
  - **Panel Title**: `text-3xl font-black`
  - **Eyebrow / Section Header**: `text-xs font-bold uppercase tracking-[.18em] text-brand`
  - **Card Title**: `text-sm font-semibold text-navy`
  - **Metadata / Descriptions**: `text-xs text-slate-500`
- **Copy Tone**: Conversational, clean, and helpful. Avoid overly dense technical jargon; explain state transitions clearly (e.g., *"Ready to become your default pet"* instead of *"State: INSTALLED, ACTIVE: FALSE"*).

---

## 5. Colors & Semantic Palette

All colors are mapped to functional roles to ensure consistency across themes.

| Role | Color / Hex | Tailwind Equivalent | Semantic Usage |
| :--- | :--- | :--- | :--- |
| **Brand Primary** | `#176df2` / `#3b96ff` | `bg-brand` / `text-brand` | Active filters, primary buttons, hero accents |
| **Dark Neutral** | `#102149` | `text-navy` | Main body text, card titles, heavy headings |
| **Light Neutral** | `#f8fbff` to `#e9f3ff` | `bg-slate-50` / `bg-blue-50` | Page backdrops, card backgrounds, empty states |
| **Slate Copy** | `#5c6e91` | `text-slatecopy` | Subtitles, helper text, inactive buttons, labels |
| **Success / Ready** | `#059669` / `#34d399` | `emerald` | Active indicators, successfully installed badges |
| **Warning / Import** | `#d97706` / `#fbbf24` | `amber` | Codex source indicators, imports, attention states |
| **Featured** | `#7e22ce` / `#a855f7` | `purple` | Featured catalog filters and badges |
| **Originals** | `#ca8a04` / `#facc15` | `yellow` | Original OpenPets catalog filters and badges |
| **Danger / Remove** | `#dc2626` / `#ff6b6b` | `red` | Destructive actions, broken states, error messages |

---

## 6. Tactile Button System

Buttons are the core interactive elements. They reject flat modern trends in favor of a chunky, tangible 3D appearance inspired by physical pet hardware and OS controls.

### Visual Architecture
- **Borders**: Darker semi-transparent bottom/side borders (`rgba(..., 0.32)`).
- **Gradients**: Linear vertical gradients that transition from a lighter top to a richer bottom.
- **Inset Highlights**: A subtle light line (`inset 0 1px 0 rgba(255,255,255,0.38)`) on the top edge to simulate light catching the button's crown.
- **Shadows**: Keep buttons grounded. Use subtle neutral depth plus inset highlights; avoid large colored glow shadows.

### Interactive Rules
- **Hover States**: Under current design guidelines, **avoid dramatic hover glows or float lifts**. Hovering should simply shift the gradient/background color slightly to maintain a grounded, crisp, and predictable interface.
- **Active Click State**: On press, the button scales down slightly to `0.96` to provide a satisfying physical click response.
  - **Constraint**: Always use targeted transitions (`transition-[transform,background-color,border-color,box-shadow]`) instead of `transition-all` to prevent layout reflow stutter.

### Button Variants

1. **Primary** (`.btn-primary`):
   - Gradient: `#3b96ff` to `#176df2`
   - Shadow: `inset 0 1px 0 rgba(255,255,255,0.38), 0 2px 4px rgba(61,99,160,0.10)`
2. **Secondary** (`.btn-secondary`):
   - Surface: `rgba(255,255,255,0.76)` with text `#176df2`
   - Border: `rgba(37, 99, 235, 0.42)`
3. **Danger** (`.btn-danger`):
   - Gradient: `#ff6b6b` to `#dc2626`
   - Shadow: same subtle neutral depth as primary; do not add red glow
4. **Warning** (`.btn-warning`):
   - Gradient: `#fbbf24` to `#d97706`
5. **Success** (`.btn-success`):
   - Gradient: `#34d399` to `#059669`
6. **Compact Button** (`.btn-compact`):
   - Designed for pagination (`.pager`) and secondary rows.
   - Reduces size to `min-h-[30px]`, padding to `px-2.5 py-1`, and font size to `text-xs` with a tighter border-radius (`rounded-xl`).

---

## 7. Controls & Navigation Elements

### Filters (`.filter`)
- Instead of simple pill badges, filters are structured as miniature tactile buttons.
- Inactive filters use a soft white-to-slate gradient with a light blue-grey border.
- Active filters swap to semantic gradients with only subtle grounded depth:
  - Brand blue for general filters (`All`, `Installed`, `Western`, `Asian`, `Codex`)
  - Purple for `Featured`
  - Amber/yellow-orange for `Originals`
- Match catalog v3/web gallery taxonomy where possible: `Featured` excludes originals, and category filters like `Western`/`Asian` exclude featured and originals.

### Pet Cards & Badges
- Card grids need inner padding so selected rings and focus states are not clipped by the scroll container.
- Use badges to expose catalog identity, not just install state:
  - `Original` for original/OpenPets pets
  - `Featured` for featured non-original catalog pets
  - `Western` / `Asian` for standard category pets
  - `Default`, `Installed`, and `Codex` for local state/source
- Avoid low-value detail badges such as `Available`; reserve detail badges for meaningful state or catalog identity.

### Search Inputs (`.search`)
- Rendered as soft, inset text boxes.
- Styled with `bg-white/80` and `shadow-inner` to look recessed into the panel.
- Focus states use a visible but restrained brand ring (`focus:ring-brand/15 focus:border-brand`) for accessibility.

### Pager (`.pager`)
- Placed cleanly at the **bottom** of list/grid containers.
- Merges compact secondary buttons with centered, bold, uppercase status text (`text-xs font-bold tracking-wider`).

---

## 8. Icons & Visual Assets

- **Coherency**: Use clean, outline-style vectors with a consistent stroke weight (`stroke-width="2.5"` or `3` for smaller shapes).
- **Style Alignment**: Align with the **Lucide / Iconify** icon libraries.
- **Implementation**: Embed icons as stateless, inline React SVG components or a localized icon catalog within the component file to avoid heavy runtime dependencies.
- **Sizing**:
  - Action/Button Icons: `16px x 16px`
  - Compact/Filter Icons: `12px x 12px` or `14px x 14px`

---

## 9. React & Tailwind Implementation Notes

### The Static Purge Constraint
Tailwind CSS extracts classes statically by analyzing source code strings. **Do not construct class names dynamically**.

```tsx
// ❌ BAD: Will be purged by Tailwind in production
const color = "blue";
return <span className={`pill-${color}`}>Label</span>;

//  GOOD: Statically discoverable mapping
const statusPillToneClass = {
  blue: "pill-blue",
  green: "pill-green",
} as const;
return <span className={`pill ${statusPillToneClass[tone]}`}>Label</span>;
```

---

## 10. Migration Playbook for Future Pages

When refactoring other Control Center views, apply the following structural mapping:

### A. Settings Page
- **Old Layout**: Long scrolling list of form controls.
- **New Layout**: Split-pane layout. Left side lists settings categories (General, Hotkeys, Performance) using `.filter` tactile navigation. Right side contains the active form wrapped in a `.glass` card.
- **Inputs**: Swap default inputs to the recessed `.search` input style. Use `.btn-primary` for the final "Save" action.

### B. Plugins Page
- **Old Layout**: Flat list of available integrations.
- **New Layout**: Grid-based layout matching the `.pets-grid` structure. 
- **Cards**: Use the `.pet-card` styling with a thumbnail on the left, author/description text on the right, and semantic status pills (e.g., `.pill-green` for "Active", `.pill-slate` for "Disabled").

### C. Onboarding
- **Old Layout**: Full screen wizard.
- **New Layout**: Centered, floating glass card (`.glass` with `max-w-xl shadow-glass`) layered over the atmospheric radial backdrop.
- **Interaction**: Use staggered CSS keyframes for a smooth entrance, and a prominent `.btn-primary` with active scaling for the "Get Started" call to action.
