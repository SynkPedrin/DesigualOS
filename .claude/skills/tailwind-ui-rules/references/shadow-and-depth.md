# Shadow and Depth System

Shadows communicate hierarchy, interactivity, and spatial relationships. A disciplined shadow system prevents visual noise and keeps the interface readable. This reference covers shadow levels, dark mode strategies, colored shadows, and 3D interaction effects using TailwindCSS utilities.

## Shadow Hierarchy

Each level corresponds to a specific degree of perceived elevation. Map every element in your design to exactly one level.

| Level | Class | Visual Effect | Use Cases |
|-------|-------|--------------|-----------|
| 0 | `border border-gray-200` | No shadow, defined edge | Inline elements, list items, table cells |
| 1 | `shadow-sm` | Barely perceptible lift | Cards at rest, input fields, subtle containers |
| 2 | `shadow-md` | Clear elevation | Hovered cards, active dropdowns, tooltips |
| 3 | `shadow-lg` | Prominent float | Popovers, floating panels, toasts |
| 4 | `shadow-xl` / `shadow-2xl` | Maximum elevation | Modal dialogs, command palettes, overlays |

**Rule**: Pick at most 3 of these 5 levels for your design system. Using all five creates ambiguous depth relationships where the user cannot distinguish between layers. Typical combinations are Level 0 + Level 1 + Level 3, or Level 1 + Level 2 + Level 4. The important thing is clear separation between the levels you choose.

## Card Elevation Pattern

Cards are the most common shadow-bearing element. Here is a complete card at each level with full TailwindCSS classes:

```html
<!-- Level 0: Flat card (border only) -->
<div class="rounded-lg border border-gray-200 dark:border-gray-700 p-6">
  Flat content with defined edges, no perceived lift.
</div>

<!-- Level 1: Subtle lift (default card) -->
<div class="rounded-lg shadow-sm p-6">
  Standard resting state for cards in dashboards and content layouts.
</div>

<!-- Level 2: Elevated (hovered/active) -->
<div class="rounded-lg shadow-md p-6">
  Active state or hovered card, clearly above surrounding content.
</div>

<!-- Level 3: Floating (modal/overlay) -->
<div class="rounded-lg shadow-xl p-6">
  Floats above the page. Reserved for overlays, modals, and popovers.
</div>
```

Every card in the same container or grid must share the same resting shadow level. Mixed levels within a group break visual consistency and confuse the spatial model.

## Hover Elevation

Cards that respond to hover should step up exactly one shadow level and lift slightly along the Y axis:

```html
<div class="rounded-lg shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6">
  This card lifts subtly on hover to signal interactivity.
</div>
```

Rules for hover elevation:
- Step up exactly ONE shadow level on hover (shadow-sm to shadow-md, never shadow-sm to shadow-xl).
- Combine with a subtle `hover:-translate-y-0.5` which translates to 2px. Do not use `-translate-y-1` or larger values because exaggerated movement feels unpolished and distracts from content.
- Always include `transition-all duration-200` so the shadow and transform animate together smoothly. Without the transition, the change appears as a jarring snap.

## Dark Mode Shadows

Shadows are barely visible on dark backgrounds because there is little contrast between the shadow color and the surface. You need an alternative strategy to communicate depth in dark mode.

```html
<!-- Approach 1: Remove shadows, use borders -->
<div class="shadow-sm dark:shadow-none dark:border dark:border-gray-700 rounded-lg p-6">
  Clean separation using a subtle border in dark mode.
</div>

<!-- Approach 2: Use darker, more opaque shadows -->
<div class="shadow-sm dark:shadow-lg dark:shadow-black/30 rounded-lg p-6">
  Heavier shadow that remains visible against dark surfaces.
</div>

<!-- Approach 3: Use ring for subtle definition -->
<div class="shadow-sm dark:shadow-none dark:ring-1 dark:ring-gray-700 rounded-lg p-6">
  Ring provides a crisp 1px edge without shadow rendering overhead.
</div>
```

Approach 1 or 3 are the cleanest solutions and work well in the vast majority of interfaces. Borders and rings are predictable, lightweight, and render consistently across browsers. Use Approach 2 only when you specifically need the perception of floating depth in dark mode, such as modals or command palettes that must appear above a dark backdrop.

## Colored Shadows

Colored shadows draw attention and create visual emphasis. They should be used surgically on one or two elements per page that need to stand out.

```html
<!-- DO: Primary CTA button -->
<button class="bg-blue-600 shadow-lg shadow-blue-600/25 hover:shadow-blue-600/40">
  Get Started
</button>

<!-- DO: Accent card highlighting something important -->
<div class="border-l-4 border-blue-500 shadow-md shadow-blue-500/10">
  Featured announcement or alert content.
</div>

<!-- DON'T: Neutral container -->
<div class="shadow-lg shadow-gray-500/25">  <!-- Just use shadow-lg -->
  Regular content that does not need color emphasis.
</div>

<!-- DON'T: Every card in a grid -->
<div class="shadow-md shadow-purple-500/20">  <!-- Visual chaos -->
  One of many identical cards. Colored shadow here creates noise.
</div>
```

**Rule**: Colored shadows only on 1-2 elements per page that need emphasis. Never apply them to regular containers, grid items, or repeated components. When everything glows, nothing stands out.

## 3D Hover Effects

Translate and perspective transforms can create interactive depth effects. Use them with restraint.

```html
<!-- Subtle lift (most common, safest) -->
<div class="hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
  Cards, list items, and any clickable surface.
</div>

<!-- Button press effect -->
<button class="hover:-translate-y-0.5 active:translate-y-0 transition-transform duration-150">
  Lifts on hover, returns to baseline on click for tactile feedback.
</button>

<!-- Perspective tilt (use sparingly) -->
<div class="hover:[transform:perspective(800px)_rotateY(-2deg)] transition-transform duration-300">
  Featured hero card or single showcase element only.
</div>
```

Rules for 3D effects:
- `translate-y`: maximum `-0.5` (2px) for standard cards. Use `-1` (4px) only for large hero elements or feature showcases.
- Always pair movement with `transition-transform` or `transition-all` so changes animate smoothly.
- Perspective tilt effects belong on single featured elements only. Never apply them to items in a grid or repeated list because simultaneous tilting across multiple elements looks chaotic.
- Use `active:translate-y-0` on buttons to create a satisfying "press down" feedback that complements the hover lift.

## Shadow Anti-Patterns

Common mistakes that undermine a coherent depth system:

| Don't | Why | Do Instead |
|-------|-----|-----------|
| `shadow-2xl` on small badges | Disproportionate to element size, looks like a rendering bug | `shadow-sm` or no shadow |
| Different shadow levels on cards in the same grid | Breaks visual consistency, implies false hierarchy | Same shadow level for all cards in a group |
| `shadow-inner` on cards | Creates a sunken look that confuses the depth model | Reserve `shadow-inner` for inset inputs and pressed states only |
| Mixing shadow directions | Some shadows up, some down looks broken and inconsistent | Maintain consistent shadow direction across all elements |
| `shadow-xl` + `border-2` + `ring-2` | Triple depth cues compete with each other and create visual noise | Pick one depth technique per element |

A well-structured shadow system uses fewer levels, applies them consistently, and adapts cleanly for dark mode. When in doubt, use less shadow rather than more.

## Glassmorphism (Frosted Glass)

Glassmorphism uses translucent backgrounds with backdrop blur to create a frosted glass effect. Use it for overlays, modals, floating navigation, or feature cards that sit on top of vibrant backgrounds.

### Basic Glassmorphism Pattern

```html
<!-- Glass card on a colorful background -->
<div class="relative bg-gradient-to-br from-purple-500 to-blue-600 p-12 rounded-2xl">
  <div class="
    rounded-xl p-6
    bg-white/10
    backdrop-blur-md
    border border-white/20
    shadow-lg
  ">
    <h3 class="text-lg font-semibold text-white">Glass Card</h3>
    <p class="mt-2 text-white/80">Content visible through frosted glass.</p>
  </div>
</div>
```

### Glassmorphism Variants

```html
<!-- Light glass (for dark backgrounds) -->
<div class="bg-white/15 backdrop-blur-md border border-white/20">

<!-- Dark glass (for light backgrounds) -->
<div class="bg-black/10 backdrop-blur-md border border-black/10">

<!-- Frosted navigation bar -->
<nav class="
  sticky top-0 z-20
  bg-white/70 dark:bg-gray-900/70
  backdrop-blur-lg
  border-b border-gray-200/50 dark:border-gray-700/50
">
```

### Glassmorphism Rules

- **Requires a colorful or image background** to be visible. On a solid white/gray background, glass effects are invisible and the blur adds GPU cost for nothing.
- Use `backdrop-blur-md` (12px) as default. `backdrop-blur-sm` (4px) is too subtle; `backdrop-blur-xl` (24px) is heavy and can obscure the background entirely.
- Background opacity: `bg-white/10` to `bg-white/30` for dark backgrounds. `bg-black/5` to `bg-black/15` for light backgrounds. Going higher than /30 defeats the glass effect.
- Always add `border border-white/20` — without the border, glass elements blend into the background and lose their shape.
- **Performance**: `backdrop-blur` is GPU-intensive. Limit to 2-3 glass elements per page. Never apply to every card in a grid.
- **Text contrast**: Glass surfaces reduce contrast. Use bold text (`font-semibold` or `font-bold`) and ensure `text-white` or `text-gray-900` depending on background.

## Neumorphism (Soft UI)

Neumorphism creates an extruded or inset appearance using paired light and dark shadows on a matching background. Use sparingly — only for toggle controls, sliders, or small decorative elements. Never for entire layouts.

### Neumorphic Toggle

```html
<!-- Neumorphic container (background must match shadow base) -->
<div class="bg-gray-200 rounded-2xl p-1 inline-flex
  shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1),inset_-2px_-2px_4px_rgba(255,255,255,0.7)]
">
  <button class="px-4 py-2 rounded-xl text-sm font-medium
    bg-gray-200
    shadow-[2px_2px_4px_rgba(0,0,0,0.1),-2px_-2px_4px_rgba(255,255,255,0.7)]
    text-gray-700
  ">
    Option A
  </button>
  <button class="px-4 py-2 rounded-xl text-sm font-medium text-gray-400">
    Option B
  </button>
</div>
```

### Neumorphism Rules

- **Background color must match** the element color. Neumorphism only works when the element appears extruded from a surface of the same color.
- Limit to small interactive controls (toggles, sliders, icon buttons). Full neumorphic layouts look flat and have poor contrast.
- Does NOT work in dark mode. The dual-shadow technique requires a light, neutral surface.
- Pair the light shadow (`rgba(255,255,255,0.7)`) with a dark shadow (`rgba(0,0,0,0.1)`) — offset in opposite directions.
- Never combine neumorphism with `shadow-*` Tailwind utilities. They conflict visually.

## Modern Gradient Techniques

### Standard TailwindCSS Gradients

```html
<!-- Linear gradient -->
<div class="bg-gradient-to-r from-blue-500 to-purple-600">

<!-- Gradient with via color (3-stop) -->
<div class="bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500">

<!-- Gradient text -->
<h1 class="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
  Gradient Heading
</h1>

<!-- Subtle gradient for backgrounds -->
<div class="bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
```

### Gradient Rules

- **Direction matters**: `to-r` (horizontal) for wide elements like banners. `to-b` (vertical) for page backgrounds and sections. `to-br` (diagonal) for cards and featured elements.
- Use `via-*` for 3-stop gradients that feel more natural. Two-stop gradients can look harsh.
- **Gradient text**: Always use `bg-clip-text text-transparent`. Only apply to headings and short labels — never body text (illegible).
- **Dark mode gradients**: Always define `dark:from-*` and `dark:to-*`. Light gradients on dark backgrounds look broken.
- Limit gradient backgrounds to 1-2 per page. Too many competing gradients create visual chaos.

### Mesh Gradient Effect (CSS approximation)

```html
<!-- Approximate mesh gradient using layered radials (requires custom CSS) -->
<div class="relative overflow-hidden rounded-2xl">
  <div class="absolute inset-0 bg-gradient-to-br from-blue-400/30 via-transparent to-purple-400/30"></div>
  <div class="absolute inset-0 bg-gradient-to-tl from-pink-400/20 via-transparent to-cyan-400/20"></div>
  <div class="relative z-10 p-8">
    Content on top of mesh-like gradient.
  </div>
</div>
```

**Rule**: True mesh gradients require CSS `background: radial-gradient(...)` layering or tools like MeshGradient. The TailwindCSS approximation above works for subtle background effects but cannot replicate complex mesh patterns. For hero sections needing true mesh gradients, use custom CSS or an SVG/image background.
