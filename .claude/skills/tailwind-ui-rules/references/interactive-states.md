# Interactive States

Every interactive element must provide visual feedback for hover, focus-visible, active, and disabled states. Missing states make interfaces feel broken and inaccessible. Users rely on these cues to understand what is clickable, what is focused, and what is unavailable. A button without a hover state feels dead. An input without a focus ring is invisible to keyboard users. Treat state coverage as a requirement, not an enhancement.

## Button States

### Primary Button
```html
<button class="
  px-4 py-2.5 rounded-lg font-medium text-sm
  bg-blue-600 text-white
  hover:bg-blue-700
  active:bg-blue-800 active:scale-[0.98]
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600
  transition-all duration-150
">
  Primary Action
</button>
```

### Secondary Button (outline)
```html
<button class="
  px-4 py-2.5 rounded-lg font-medium text-sm
  border border-gray-300 text-gray-700 bg-white
  hover:bg-gray-50 hover:border-gray-400
  active:bg-gray-100
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
  dark:border-gray-600 dark:text-gray-300 dark:bg-transparent
  dark:hover:bg-gray-800 dark:hover:border-gray-500
  transition-all duration-150
">
  Secondary Action
</button>
```

### Ghost/Subtle Button
```html
<button class="
  px-3 py-2 rounded-md font-medium text-sm
  text-gray-600
  hover:bg-gray-100 hover:text-gray-900
  active:bg-gray-200
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2
  dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200
  transition-all duration-150
">
  Subtle Action
</button>
```

### Destructive Button
```html
<button class="
  px-4 py-2.5 rounded-lg font-medium text-sm
  bg-red-600 text-white
  hover:bg-red-700
  active:bg-red-800
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-colors duration-150
">
  Delete
</button>
```

**Button State Rules:**
- `disabled:hover:` must reset to the default bg color (prevent hover effect on disabled buttons).
- `active:scale-[0.98]` is an optional press-down effect. Use on primary buttons only, not on small icon buttons.
- Transition duration: 150ms for buttons (fast, snappy feedback).

## Form Input States

### Text Input
```html
<input class="
  w-full px-3 py-2 rounded-md text-sm
  border border-gray-300 bg-white text-gray-900
  placeholder:text-gray-400
  hover:border-gray-400
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
  disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
  dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100
  dark:focus:ring-blue-400
  transition-colors duration-150
" placeholder="Enter value..." />
```

Note: Use `focus:` (not `focus-visible:`) for form inputs because inputs always have visible focus when clicked AND when tabbed.

### Error State Input
```html
<div>
  <input class="
    w-full px-3 py-2 rounded-md text-sm
    border border-red-500 bg-white text-gray-900
    focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500
    dark:border-red-400 dark:bg-gray-900
    transition-colors duration-150
  " />
  <p class="mt-1.5 text-sm text-red-600 dark:text-red-400">This field is required.</p>
</div>
```

### Select Input
```html
<select class="
  w-full px-3 py-2 rounded-md text-sm appearance-none
  border border-gray-300 bg-white text-gray-900
  hover:border-gray-400
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
  disabled:bg-gray-50 disabled:cursor-not-allowed
  dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100
  transition-colors duration-150
">
```

## Card Hover Effects

### Lift Effect (recommended default)
```html
<div class="
  rounded-lg border border-gray-200 p-6
  shadow-sm
  hover:shadow-md hover:-translate-y-0.5
  transition-all duration-200
  cursor-pointer
">
```

### Border Highlight Effect
```html
<div class="
  rounded-lg border border-gray-200 p-6
  hover:border-blue-500
  transition-colors duration-200
  cursor-pointer
">
```

### Background Shift Effect
```html
<div class="
  rounded-lg border border-gray-200 p-6
  hover:bg-gray-50 dark:hover:bg-gray-800
  transition-colors duration-150
  cursor-pointer
">
```

**Card Rules:**
- Pick ONE hover effect per card type. Never combine lift + border highlight + background shift on the same card.
- Add `cursor-pointer` to any clickable card.
- Use `duration-200` for cards (slightly slower than buttons, feels more natural for larger elements).

## Focus Ring Patterns

The ring utilities in Tailwind provide consistent, accessible focus indicators across all interactive elements.

```html
<!-- Standard focus ring -->
focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2

<!-- Focus ring with dark mode offset color -->
focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900

<!-- Inset focus ring (for elements where offset doesn't look right) -->
focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500
```

Rules:
- `ring-offset-2` creates a gap between element and ring. This looks cleaner than a ring flush against the element edge.
- Dark mode: the ring-offset color defaults to white. Override with `dark:ring-offset-gray-900` to match the dark background.
- `ring-inset` should be used on elements that sit flush against edges, such as table cells and nav items within a container.

## Transition Timing Guide

| Element Type | Duration | Class |
|-------------|----------|-------|
| Buttons, links | 150ms | `transition-colors duration-150` |
| Cards, panels | 200ms | `transition-all duration-200` |
| Modals, overlays | 300ms | `transition-all duration-300` |
| Page transitions | 500ms | `transition-opacity duration-500` |

Rule: Smaller elements get shorter durations. Larger movements get longer durations. Never exceed 500ms for any UI transition. Anything longer feels sluggish and degrades perceived performance.

## Skeleton Loading States

Skeleton screens show placeholder shapes that match the content layout while data loads. They reduce perceived load time and feel faster than spinners.

### Basic Skeleton Card

```html
<!-- Skeleton placeholder matching a user card layout -->
<div class="rounded-lg border border-gray-200 p-6 dark:border-gray-700">
  <!-- Avatar placeholder -->
  <div class="h-12 w-12 rounded-full bg-gray-200 animate-pulse dark:bg-gray-700"></div>

  <!-- Name placeholder -->
  <div class="mt-4 h-4 w-3/4 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>

  <!-- Description placeholders -->
  <div class="mt-3 space-y-2">
    <div class="h-3 w-full rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
    <div class="h-3 w-5/6 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
    <div class="h-3 w-2/3 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
  </div>

  <!-- Button placeholder -->
  <div class="mt-6 h-9 w-24 rounded-md bg-gray-200 animate-pulse dark:bg-gray-700"></div>
</div>
```

### Skeleton Table Row

```html
<div class="flex items-center gap-4 py-3 border-b border-gray-100 dark:border-gray-800">
  <div class="h-8 w-8 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
  <div class="h-3 w-32 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
  <div class="h-3 w-48 rounded bg-gray-200 animate-pulse dark:bg-gray-700 ml-auto"></div>
  <div class="h-3 w-16 rounded bg-gray-200 animate-pulse dark:bg-gray-700"></div>
</div>
```

### Skeleton Rules

- **Match the real layout**: Skeleton shapes must match the dimensions and position of the actual content. If the skeleton and real content have different layouts, the page "jumps" when data loads.
- Use `animate-pulse` for the pulsing effect. All skeleton elements in one component should pulse together (the default behavior).
- Use `rounded` for text lines, `rounded-full` for avatars, `rounded-md` for buttons.
- Vary the widths of text lines (w-full, w-5/6, w-2/3) to look natural. All lines at the same width looks robotic.
- Color: `bg-gray-200 dark:bg-gray-700` is the standard skeleton color. Never use colored skeletons.
- Only use skeletons for content that takes >300ms to load. For fast loads, showing a skeleton creates unnecessary flicker.

## Respecting prefers-reduced-motion

Users who enable "reduce motion" in their OS settings are often sensitive to animation due to vestibular disorders. Respect this preference.

### Disabling Animations

```html
<!-- Animate only when user allows it -->
<div class="motion-safe:animate-pulse">
  Pulses only if user hasn't reduced motion.
</div>

<!-- Hover effects that respect reduced motion -->
<div class="
  transition-all duration-200
  hover:shadow-md hover:-translate-y-0.5
  motion-reduce:transition-none motion-reduce:hover:translate-y-0
">
  Card lifts on hover, but stays still for reduced-motion users.
</div>

<!-- Page entrance animation with reduced-motion fallback -->
<div class="
  motion-safe:animate-fade-in
  motion-reduce:opacity-100
">
  Fades in normally; instantly visible for reduced-motion users.
</div>
```

### Reduced Motion Rules

- Use `motion-safe:` prefix for animations that should ONLY play when the user allows motion.
- Use `motion-reduce:` prefix to override animations for users who prefer reduced motion.
- **Always provide reduced-motion alternatives** for any animation that changes position (translate, scale). Color and opacity transitions are generally acceptable.
- Skeleton loading (`animate-pulse`) should use `motion-safe:animate-pulse` — offer a static skeleton for reduced-motion users.
- Never ignore this preference. It is an accessibility requirement, not a suggestion.

## Advanced Card Variants

### Glassmorphic Card

```html
<div class="
  rounded-2xl p-6
  bg-white/10 backdrop-blur-md
  border border-white/20
  shadow-lg
  hover:bg-white/15
  transition-colors duration-200
">
  <h3 class="text-lg font-semibold text-white">Glass Card</h3>
  <p class="mt-2 text-white/70">Frosted glass aesthetic.</p>
</div>
```

Use only on colorful or image backgrounds. See `shadow-and-depth.md` for full glassmorphism rules.

### Gradient Border Card

```html
<!-- Gradient border using a wrapper technique -->
<div class="rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 p-[1px]">
  <div class="rounded-[calc(1rem-1px)] bg-white dark:bg-gray-900 p-6">
    <h3 class="font-semibold">Gradient Border</h3>
    <p class="mt-2 text-gray-600 dark:text-gray-400">Outer gradient wrapper with inner content.</p>
  </div>
</div>
```

### Interactive Feature Card

```html
<div class="
  group relative rounded-2xl border border-gray-200 p-6 overflow-hidden
  hover:border-blue-500/50
  transition-all duration-300
  dark:border-gray-700 dark:hover:border-blue-400/50
">
  <!-- Subtle gradient overlay on hover -->
  <div class="absolute inset-0 bg-gradient-to-br from-blue-50/0 to-blue-50/50
    opacity-0 group-hover:opacity-100 transition-opacity duration-300
    dark:from-blue-950/0 dark:to-blue-950/30
  "></div>

  <div class="relative z-10">
    <h3 class="font-semibold">Feature Title</h3>
    <p class="mt-2 text-gray-600 dark:text-gray-400">Feature description.</p>
    <span class="mt-4 inline-flex items-center text-sm font-medium text-blue-600
      group-hover:translate-x-1 transition-transform duration-200
      dark:text-blue-400
    ">
      Learn more &rarr;
    </span>
  </div>
</div>
```

### Advanced Card Rules

- Use the `group` / `group-hover:` pattern for coordinated hover effects across child elements.
- `overflow-hidden` is mandatory when using absolute-positioned hover overlays inside cards.
- Gradient border technique: outer div is the gradient, inner div is the content background. Use `p-[1px]` on outer for 1px border width.
- Only use advanced card variants for featured or hero content. Standard cards in a grid should use the basic lift or border-highlight pattern.
