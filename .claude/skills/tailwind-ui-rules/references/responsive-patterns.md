# Responsive Design Patterns

TailwindCSS is mobile-first. Base styles target mobile, larger breakpoints layer on top. This is non-negotiable. Every class without a prefix applies at all screen sizes, and prefixed classes override at their respective breakpoint and above.

## Breakpoint Reference

| Prefix | Min Width | Typical Devices |
|--------|-----------|-----------------|
| (none) | 0px | Mobile phones (portrait) |
| sm: | 640px | Mobile phones (landscape), small tablets |
| md: | 768px | Tablets (portrait) |
| lg: | 1024px | Tablets (landscape), small desktops |
| xl: | 1280px | Desktops |
| 2xl: | 1536px | Large desktops |

Rule: Most designs only need 3 breakpoints: base (mobile), md: (tablet), lg: (desktop). Use xl: and 2xl: sparingly.

## Mobile-First Class Ordering

WRONG (desktop-first thinking):
```html
<div class="flex items-center justify-between md:flex-col md:items-start sm:hidden">
```

CORRECT (mobile-first):
```html
<div class="hidden sm:flex sm:flex-col sm:items-start lg:flex-row lg:items-center lg:justify-between">
```

Rule: Start with the mobile layout (no prefix), then add complexity with sm:, md:, lg: prefixes. Always ask "what does this look like on the smallest screen first?"

## Responsive Navigation

A complete responsive navigation pattern showing hamburger on mobile and horizontal nav on desktop:

```html
<!-- Mobile: hamburger menu, Desktop: horizontal nav -->
<nav class="flex items-center justify-between h-16 px-4 lg:px-8">
  <!-- Logo (always visible) -->
  <a href="/" class="text-xl font-bold">Brand</a>

  <!-- Desktop navigation (hidden on mobile) -->
  <div class="hidden lg:flex lg:items-center lg:gap-8">
    <a href="#" class="text-sm font-medium text-gray-600 hover:text-gray-900">Features</a>
    <a href="#" class="text-sm font-medium text-gray-600 hover:text-gray-900">Pricing</a>
    <a href="#" class="text-sm font-medium text-gray-600 hover:text-gray-900">About</a>
    <button class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
      Sign Up
    </button>
  </div>

  <!-- Mobile menu button (hidden on desktop) -->
  <button class="lg:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100" aria-label="Open menu">
    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>
</nav>
```

## Responsive Card Grid

The standard responsive grid progression:

```html
<!-- 1 col mobile -> 2 col tablet -> 3 col desktop -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
  <div class="rounded-lg border p-6">Card 1</div>
  <div class="rounded-lg border p-6">Card 2</div>
  <div class="rounded-lg border p-6">Card 3</div>
  <div class="rounded-lg border p-6">Card 4</div>
  <div class="rounded-lg border p-6">Card 5</div>
  <div class="rounded-lg border p-6">Card 6</div>
</div>
```

Variants for different card sizes:
```html
<!-- Large cards: 1 -> 2 col -->
<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">

<!-- Small cards/thumbnails: 2 -> 3 -> 4 col -->
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">

<!-- Feature grid with wide items: 1 -> 2 -> 3 col -->
<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
```

## Responsive Typography Scale

Text sizes should scale across breakpoints to maintain proportion:

```html
<!-- Hero heading -->
<h1 class="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tight">

<!-- Section heading -->
<h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold">

<!-- Subsection heading -->
<h3 class="text-xl lg:text-2xl font-semibold">

<!-- Body text (rarely needs scaling) -->
<p class="text-base lg:text-lg">
```

Rules:
- Body text (text-base = 16px) is readable at all sizes. Only scale up at lg: if you want a more spacious feel.
- Headings MUST scale. A text-5xl heading on mobile is far too large.
- Use tracking-tight on large headings (text-4xl+) to improve readability.

## Responsive Spacing Scale

Vertical section spacing should increase with screen size:

```html
<!-- Section padding -->
<section class="py-12 sm:py-16 lg:py-24">

<!-- Component gap -->
<div class="space-y-8 lg:space-y-12">

<!-- Container horizontal padding -->
<div class="px-4 sm:px-6 lg:px-8">
```

Rule: Spacing ratios roughly follow 1x (mobile), 1.3x (tablet), 2x (desktop).

## Responsive Stack-to-Row Pattern

Items stack vertically on mobile and sit in a row on desktop. This is one of the most common responsive patterns:

```html
<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
  <div class="lg:flex-1">Content area</div>
  <div class="lg:w-80 lg:shrink-0">Sidebar / Image</div>
</div>
```

## Responsive Image Patterns

```html
<!-- Full-width on mobile, constrained on desktop -->
<img class="w-full rounded-lg lg:max-w-md lg:mx-auto" src="..." alt="..." />

<!-- Aspect ratio container -->
<div class="aspect-video rounded-lg overflow-hidden">
  <img class="w-full h-full object-cover" src="..." alt="..." />
</div>
```

## Touch Target Sizing

Rule: All interactive elements must be at least 44x44px on mobile (WCAG 2.5.5).

```html
<!-- Minimum touch target -->
<button class="min-h-[44px] min-w-[44px] p-2.5">
  <svg class="h-5 w-5">...</svg>
</button>

<!-- Link in a list (extend tap area with negative margin) -->
<a class="block py-3 px-4 -mx-4">
  Link text
</a>
```

## Fluid Typography with clamp()

Instead of stepping through fixed font sizes at breakpoints, fluid typography scales smoothly between a minimum and maximum size. This produces more natural, proportional text at every viewport width.

### Fluid Type Pattern

```html
<!-- Fluid hero heading: 1.875rem at 320px → 3.75rem at 1280px -->
<h1 class="font-bold tracking-tight" style="font-size: clamp(1.875rem, 1.25rem + 2.5vw, 3.75rem);">
  Fluid Heading
</h1>

<!-- Fluid section heading: 1.5rem → 2.25rem -->
<h2 class="font-bold" style="font-size: clamp(1.5rem, 1.125rem + 1.5vw, 2.25rem);">
  Section Title
</h2>

<!-- Fluid body text: 1rem → 1.125rem -->
<p style="font-size: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);">
  Body text that scales subtly.
</p>
```

### Defining Fluid Types in Tailwind Config

For cleaner markup, define fluid sizes in `tailwind.config.js`:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontSize: {
        'fluid-sm': 'clamp(0.875rem, 0.8rem + 0.25vw, 1rem)',
        'fluid-base': 'clamp(1rem, 0.95rem + 0.25vw, 1.125rem)',
        'fluid-lg': 'clamp(1.25rem, 1rem + 1vw, 1.75rem)',
        'fluid-xl': 'clamp(1.5rem, 1.125rem + 1.5vw, 2.25rem)',
        'fluid-2xl': 'clamp(1.875rem, 1.25rem + 2.5vw, 3rem)',
        'fluid-3xl': 'clamp(2.25rem, 1.5rem + 3vw, 3.75rem)',
      }
    }
  }
}
```

Then use as: `<h1 class="text-fluid-3xl font-bold tracking-tight">`

### Fluid Typography Rules

- **clamp(min, preferred, max)**: min is the mobile size, max is the desktop size, preferred is the scaling formula.
- The `vw` value in the preferred expression controls how aggressively the size scales. `2.5vw` is aggressive (headings), `0.25vw` is subtle (body text).
- Body text rarely needs fluid sizing. `text-base` (16px) reads well at all sizes. Only make body text fluid if the design specifically calls for it.
- Always include a `rem` base in the preferred value (e.g., `1.25rem + 2.5vw`), not just `vw` alone. Pure `vw` sizing becomes unreadably small on narrow viewports.
- **Line height**: Use `leading-tight` (1.25) for fluid headings. Line height does not need to be fluid — Tailwind's defaults handle it.
- Fluid type works best for headings (h1-h3). For h4-h6 and body, breakpoint-based scaling is simpler and sufficient.

### When to Use Fluid vs Breakpoint Scaling

| Element | Fluid (clamp) | Breakpoint (sm:/lg:) |
|---------|---------------|---------------------|
| Hero headings (h1) | Preferred — smooth scaling | Acceptable but jumpy |
| Section headings (h2) | Good fit | Also fine |
| Subheadings (h3-h4) | Optional | Preferred — simpler |
| Body text | Rarely needed | Standard approach |
| Labels, captions | Never | Keep at fixed size |

## Common Responsive Mistakes

| Mistake | Fix |
|---------|-----|
| Fixed widths (w-[800px]) | Use max-w-* or responsive fractions |
| text-5xl on mobile headings | text-3xl sm:text-4xl lg:text-5xl, or use fluid clamp() |
| Horizontal scroll on mobile | Test at 320px width; use overflow-hidden or w-full |
| Hidden content never shown | hidden sm:block (not block sm:hidden which hides permanently) |
| Same gap on all screen sizes | gap-4 lg:gap-6 (scale up for larger screens) |
| No touch target sizing | min-h-[44px] on all interactive elements |
| Pure vw font sizing | Always use clamp() with a rem base: clamp(1.5rem, 1rem + 2vw, 3rem) |
| Fluid body text | Body text doesn't need fluid sizing — text-base is fine everywhere |
