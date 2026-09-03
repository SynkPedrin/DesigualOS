# Layout and Spacing System

This reference covers the foundational layout patterns, spacing conventions, and alignment rules used in TailwindCSS-based interfaces. Consistent layout and spacing are the single largest contributor to a polished, professional UI. Inconsistent spacing is the most common source of visual "jank" in otherwise well-designed pages.

## Page Container Pattern

The standard page container that all page-level layouts should use:

```html
<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
  <!-- Page content -->
</div>
```

Each part serves a specific purpose:

- **mx-auto**: Centers the container horizontally within its parent. Without this, the container would be left-aligned once its max-width kicks in on wide screens.
- **max-w-7xl** (1280px): Prevents content from stretching to absurd line lengths on ultrawide monitors. Long lines of text are hard to read, and layouts that span 2560px look broken. This cap keeps content readable and visually grounded.
- **px-4 sm:px-6 lg:px-8**: Progressive horizontal padding that gives content breathing room from the viewport edges. On small screens, 16px is enough. On tablets, 24px provides more space. On desktop, 32px creates comfortable margins. This prevents content from touching the edges of the browser window at any screen size.

### Container Variants for Different Page Types

Not every page should use the same max-width:

- **Narrow content** (articles, blog posts, settings forms): Use `max-w-2xl` (672px) or `max-w-3xl` (768px). Long-form text is most readable at 50-75 characters per line, and these widths achieve that.
- **Dashboard layouts**: Use `max-w-full` with a fixed-width sidebar. The content area fills the remaining space. The sidebar provides the visual constraint instead of a max-width.
- **Marketing and landing pages**: Use `max-w-7xl` (1280px). Marketing pages often use full-width background sections with constrained inner content, so the container is applied per-section rather than wrapping the entire page.

## Spacing Scale Reference

Tailwind uses a spacing scale based on multiples of 0.25rem (4px). This table maps every commonly used value to its pixel equivalent and typical usage:

| Tailwind | rem | px | Typical Use |
|----------|-----|-----|-------------|
| 0.5 | 0.125rem | 2px | Icon-to-text gap |
| 1 | 0.25rem | 4px | Tight inline spacing |
| 1.5 | 0.375rem | 6px | Compact component gaps |
| 2 | 0.5rem | 8px | Small gaps, tag padding, badge padding |
| 3 | 0.75rem | 12px | Button padding-y, compact card padding |
| 4 | 1rem | 16px | Standard component padding, common gap |
| 5 | 1.25rem | 20px | Comfortable padding |
| 6 | 1.5rem | 24px | Card padding, section gap |
| 8 | 2rem | 32px | Large component padding |
| 10 | 2.5rem | 40px | Between major blocks |
| 12 | 3rem | 48px | Section vertical padding (mobile) |
| 16 | 4rem | 64px | Section vertical padding (desktop) |
| 20 | 5rem | 80px | Hero spacing |
| 24 | 6rem | 96px | Large hero spacing |

The key principle is to always use values from this scale rather than arbitrary values. The scale creates visual consistency because repeated spacing values produce a sense of rhythm and order.

## Flush Alignment Rules

All content blocks within a visual section must share the same left and right edges. When a heading and the content below it have different horizontal positions, the layout looks broken even if each individual element is well-styled. This is called "flush alignment" and it is non-negotiable.

**WRONG: Heading and cards have different left edges**

```html
<!-- WRONG: Heading and cards have different left edges -->
<div class="px-8">
  <h2 class="text-2xl font-bold">Our Products</h2>
</div>
<div class="px-4">
  <div class="grid grid-cols-3 gap-4">
    <div class="p-4">Card 1</div>
    <div class="p-4">Card 2</div>
    <div class="p-4">Card 3</div>
  </div>
</div>
```

The heading has 32px of padding on each side while the card grid has only 16px. The heading text and the card edges do not line up, creating a ragged, unintentional look.

**CORRECT: Shared container, consistent edges**

```html
<!-- CORRECT: Shared container, consistent edges -->
<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
  <h2 class="text-2xl font-bold mb-6">Our Products</h2>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    <div class="p-6">Card 1</div>
    <div class="p-6">Card 2</div>
    <div class="p-6">Card 3</div>
  </div>
</div>
```

**Rule**: One container controls the page edges. Everything inside inherits the same alignment. Never apply horizontal padding to multiple nested wrappers.

## Gap vs Margin

For spacing between sibling elements, `gap-*` on the parent is superior to individual margins on children. Here is why:

**WRONG: Margins on children**

```html
<div class="flex flex-col">
  <div class="mb-4">Item 1</div>
  <div class="mb-6">Item 2</div>  <!-- inconsistent! -->
  <div class="mb-4">Item 3</div>
  <div>Item 4</div>  <!-- last item has no margin -- correct, but spacing is inconsistent -->
</div>
```

**CORRECT: Gap on parent**

```html
<div class="flex flex-col gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
  <div>Item 4</div>
</div>
```

The benefits of gap over margin:

- **No trailing space**: Gap never applies after the last item, so there is no unwanted extra margin at the bottom of a list.
- **Single source of truth**: Changing the spacing between items means editing one class on the parent rather than updating every child.
- **Works with wrapping**: When used with `flex-wrap`, gap handles both row gaps and column gaps correctly. Margins require hacks to avoid extra space on wrapping edges.

**When margin IS the right choice**:

- `mb-*` on a heading before its related content block. This creates a semantic grouping where the heading "owns" the space below it.
- `mt-auto` to push an element to the bottom of a flex container (such as a button at the bottom of a card).
- Negative margins (`-mt-4`, `-mx-2`) for intentional overlap effects like pulling an image outside its container.

## Flex Layout Patterns

### Navigation Bar

```html
<nav class="flex items-center justify-between h-16 px-4">
  <div class="flex items-center gap-2">Logo + Brand</div>
  <div class="flex items-center gap-6">Nav Links</div>
  <div class="flex items-center gap-3">Actions</div>
</nav>
```

The `justify-between` pushes the three groups to the edges and center. Each group uses `items-center` to vertically align its children, and `gap-*` to space them internally.

### Card Row (Equal Width)

```html
<div class="flex gap-6">
  <div class="flex-1 min-w-0">Card 1</div>
  <div class="flex-1 min-w-0">Card 2</div>
  <div class="flex-1 min-w-0">Card 3</div>
</div>
```

Note: `min-w-0` is critical. Without it, flex items have an implicit `min-width: auto` that prevents them from shrinking below their content size. Long text or URLs inside a card will cause it to overflow the parent. Always add `min-w-0` to flex children that contain text.

### Split Layout (Sidebar + Content)

```html
<div class="flex gap-8">
  <aside class="w-64 shrink-0">Sidebar</aside>
  <main class="flex-1 min-w-0">Main content</main>
</div>
```

The sidebar has a fixed width (`w-64` = 256px) and `shrink-0` prevents it from being compressed. The main content area takes the remaining space with `flex-1`.

## Grid Layout Patterns

### Dashboard Grid

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  <div class="lg:col-span-2">Wide stat</div>
  <div>Stat 2</div>
  <div>Stat 3</div>
</div>
```

Grid is ideal for dashboard layouts because `col-span-*` lets certain items take more space without breaking the rhythm of the grid.

### Form Layout

```html
<form class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
  <div class="sm:col-span-2">Full-width field</div>
  <div>First name</div>
  <div>Last name</div>
  <div>Email</div>
  <div>Phone</div>
  <div class="sm:col-span-2">Address</div>
</form>
```

Using `gap-x-6 gap-y-4` provides wider horizontal spacing between columns and tighter vertical spacing between rows, matching how forms are typically read top-to-bottom.

### Gallery Grid

```html
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
  <!-- Uniform image cards -->
</div>
```

A tighter `gap-4` works well for image galleries where the visual content should dominate the layout.

## Section Spacing Rhythm

Define a consistent vertical rhythm between major page sections. All sections on a page should use the same vertical padding pattern unless there is a deliberate reason to deviate:

```html
<section class="py-12 sm:py-16 lg:py-24">
  <!-- Hero section -->
</section>

<section class="py-12 sm:py-16 lg:py-24">
  <!-- Features section -->
</section>

<section class="py-12 sm:py-16 lg:py-20">
  <!-- CTA section (slightly less for urgency) -->
</section>
```

**Rule**: All major sections use the same `py-*` values. Variation should be intentional and rare. When every section has different vertical padding, the page feels chaotic. When they share the same values, the page has a steady, confident rhythm.

## Bento Grid Layout

Bento grids display cards in an asymmetric, visually interesting grid where items span variable rows and columns. This is the signature layout pattern of modern dashboards and marketing pages.

### Basic Bento Grid

```html
<div class="grid grid-cols-2 lg:grid-cols-4 auto-rows-[180px] gap-4">
  <!-- Large featured item: spans 2 columns and 2 rows -->
  <div class="col-span-2 row-span-2 rounded-2xl bg-blue-600 p-6 text-white">
    <h2 class="text-2xl font-bold">Featured</h2>
    <p class="mt-2 text-blue-100">Main highlight content.</p>
  </div>

  <!-- Standard items -->
  <div class="rounded-2xl bg-gray-100 p-5 dark:bg-gray-800">
    <h3 class="font-semibold">Metric A</h3>
  </div>
  <div class="rounded-2xl bg-gray-100 p-5 dark:bg-gray-800">
    <h3 class="font-semibold">Metric B</h3>
  </div>

  <!-- Wide item: spans 2 columns -->
  <div class="col-span-2 rounded-2xl bg-gray-100 p-5 dark:bg-gray-800">
    <h3 class="font-semibold">Wide Content</h3>
  </div>

  <!-- Tall item: spans 2 rows -->
  <div class="row-span-2 rounded-2xl bg-gray-100 p-5 dark:bg-gray-800">
    <h3 class="font-semibold">Tall Content</h3>
  </div>
</div>
```

### Bento Grid Rules

- Use `auto-rows-[180px]` or `auto-rows-fr` to set a consistent row height. Without this, rows collapse to content height and the bento effect is lost.
- On mobile, collapse to `grid-cols-1` or `grid-cols-2`. Reset `col-span-2` items to `col-span-1` on small screens: `col-span-1 sm:col-span-2`.
- Use `rounded-2xl` (not `rounded-lg`) for bento items — the larger radius matches the spacious aesthetic.
- Keep gap consistent: `gap-4` for compact bentos, `gap-6` for spacious ones. Never mix gap sizes within one bento.
- All items should have the same `p-*` value for consistent internal padding.

### Responsive Bento

```html
<!-- Collapses gracefully on mobile -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[160px] sm:auto-rows-[180px] gap-4">
  <div class="sm:col-span-2 sm:row-span-2 rounded-2xl bg-blue-600 p-6">
    Featured (full-width on mobile, 2x2 on tablet+)
  </div>
  <div class="rounded-2xl bg-gray-100 p-5">Item</div>
  <div class="rounded-2xl bg-gray-100 p-5">Item</div>
  <div class="sm:col-span-2 rounded-2xl bg-gray-100 p-5">Wide item</div>
</div>
```

## Container Queries

Container queries allow components to adapt based on their parent container's size instead of the viewport. This makes components truly reusable across different layout contexts (sidebar vs main content, modal vs page).

### When to Use Container Queries vs Media Queries

| Use Container Queries | Use Media Queries |
|----------------------|-------------------|
| Component adapts to its container width | Layout adapts to viewport width |
| Same component used in sidebar AND main content | Global layout changes (nav, footer) |
| Widget that may appear in different contexts | Dark mode, print styles |
| Card that needs to be responsive inside any parent | Page-level responsive breakpoints |

### Container Query Pattern

```html
<!-- Mark the container -->
<div class="@container">
  <!-- Card adapts to container width, not viewport -->
  <div class="flex flex-col @md:flex-row @md:items-center gap-4 p-4">
    <img class="w-full @md:w-32 @md:h-32 rounded-lg object-cover" src="..." alt="..." />
    <div>
      <h3 class="text-lg @lg:text-xl font-semibold">Title</h3>
      <p class="text-sm text-gray-600">Description</p>
    </div>
  </div>
</div>
```

### Named Containers

```html
<!-- Named container for specificity -->
<aside class="@container/sidebar w-64">
  <div class="@sm/sidebar:text-xs @md/sidebar:text-sm">
    Adapts to sidebar width specifically.
  </div>
</aside>
```

### Container Query Breakpoints

| Prefix | Min Width |
|--------|-----------|
| `@xs:` | 20rem (320px) |
| `@sm:` | 24rem (384px) |
| `@md:` | 28rem (448px) |
| `@lg:` | 32rem (512px) |
| `@xl:` | 36rem (576px) |
| `@2xl:` | 42rem (672px) |

**Rule**: Use container queries for reusable components. Use media queries (responsive prefixes) for page-level layout decisions. Do not mix both on the same element.

## Overflow and Shadow Clipping

Scrollable containers (`overflow-y-auto`, `overflow-hidden`) clip the `box-shadow` of child elements. This is one of the most common layout bugs — cards at the edges of scrollable areas have their shadows cut off.

### The Root Cause

When an element has `overflow: auto`, `overflow: hidden`, or `overflow: scroll`, it creates a clipping boundary. Box shadows that extend beyond this boundary are invisible. Per CSS spec, you cannot set `overflow-x: visible` and `overflow-y: auto` — the visible axis is forced to `auto`, clipping both directions.

### Solution 1: Negative Margin + Padding (Recommended)

Add negative margins on the scroll container to expand it, then compensate with padding so content stays positioned correctly. Shadows now have space to render.

```html
<!-- Scrollable card list with visible shadows -->
<div class="-mx-4 px-4 overflow-y-auto max-h-[500px]">
  <div class="space-y-4 py-1">
    <div class="rounded-lg bg-white p-6 shadow-md hover:shadow-lg transition-shadow">
      Card 1 — shadow is fully visible
    </div>
    <div class="rounded-lg bg-white p-6 shadow-md hover:shadow-lg transition-shadow">
      Card 2 — no clipping on sides
    </div>
  </div>
</div>
```

Rules:
- Match the negative margin to the padding: `-mx-4` with `px-4`, or `-mx-3` with `px-3`.
- The margin/padding size must be at least as large as the shadow spread. `shadow-md` spreads ~6px, so `-mx-2 px-2` (8px) is sufficient. `shadow-lg` spreads ~10px, so use `-mx-3 px-3` (12px) minimum.
- Add `py-1` on the inner content wrapper to prevent top/bottom shadow clipping too.

### Solution 2: Overflow Clip (Modern CSS)

`overflow: clip` allows directional control — you can clip on one axis while keeping the other visible:

```html
<!-- Clip only vertically, let shadows escape horizontally -->
<div class="max-h-[500px] [overflow-y:auto] [overflow-x:clip]">
  <div class="rounded-lg shadow-lg p-6">Shadow extends left/right freely.</div>
</div>
```

Note: `overflow: clip` has good but not universal browser support. Use Solution 1 as a fallback for production.

### Horizontal Scroll with Shadow Preservation

```html
<!-- Horizontal scrollable card carousel -->
<div class="-mx-4 px-4 -my-2 py-2 overflow-x-auto overflow-y-visible">
  <div class="flex gap-4 w-max">
    <div class="flex-none w-72 rounded-lg bg-white p-4 shadow-lg">Card 1</div>
    <div class="flex-none w-72 rounded-lg bg-white p-4 shadow-lg">Card 2</div>
    <div class="flex-none w-72 rounded-lg bg-white p-4 shadow-lg">Card 3</div>
  </div>
</div>
```

- `-mx-4 px-4` preserves side shadows.
- `-my-2 py-2` preserves top/bottom shadows.
- `flex-none w-72` prevents cards from shrinking in the flex container.

### Scroll Indicator Shadows

Show users that content is scrollable by adding top/bottom gradient shadows that appear on scroll:

```html
<!-- Scroll container with gradient indicators (CSS-only) -->
<div class="relative">
  <!-- Top fade indicator -->
  <div class="pointer-events-none absolute top-0 left-0 right-0 z-10 h-6
    bg-gradient-to-b from-white to-transparent dark:from-gray-900
  "></div>

  <!-- Scrollable content -->
  <div class="overflow-y-auto max-h-96 px-1">
    <!-- Content -->
  </div>

  <!-- Bottom fade indicator -->
  <div class="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-6
    bg-gradient-to-t from-white to-transparent dark:from-gray-900
  "></div>
</div>
```

Rules:
- `pointer-events-none` makes the gradient overlays click-through.
- Match the gradient `from-` color to the page background color. Use `dark:from-gray-900` for dark mode.
- Height `h-6` (24px) is a good default. Use `h-4` for compact lists, `h-8` for spacious layouts.
- For a more dynamic approach (show/hide based on scroll position), use JavaScript with IntersectionObserver on sentinel elements.

### Overflow Shadow Anti-Patterns

| Don't | Why | Do Instead |
|-------|-----|-----------|
| `overflow-hidden` on a card grid container | Clips shadows of edge cards | Use the negative margin + padding trick |
| `shadow-xl` on cards inside `overflow-y-auto` | Large shadows need large compensation margins | Use `shadow-md` maximum inside scroll containers, or expand margins |
| Scroll container without any scroll indicators | Users don't know content is scrollable | Add gradient fade overlays at top/bottom |
| `rounded-xl overflow-hidden` on parent wrapping shadowed children | Rounded corners + overflow-hidden clips child shadows aggressively | Apply rounding to individual children, not the parent |

## Common Spacing Mistakes

| Mistake | Fix |
|---------|-----|
| Different padding on cards in the same grid | Use the same `p-*` class on all cards in a group |
| margin-bottom on flex children instead of gap | Use `gap-*` on the flex parent container |
| px-4 on container + px-4 on child = double padding | Container handles page edges; children use gap or internal padding only |
| Arbitrary values like `p-[13px]` | Use scale values: `p-3` (12px) or `p-3.5` (14px) |
| No padding on mobile, too much on desktop | Use progressive padding: `px-4 sm:px-6 lg:px-8` |
| Mixing spacing approaches in the same component | Pick one approach (gap or margin) per layout context and be consistent |
| Bento items with inconsistent padding | All bento items use the same `p-*` value |
| Missing auto-rows on bento grids | Use `auto-rows-[180px]` to set consistent row height |
