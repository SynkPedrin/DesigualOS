# Common AI-Generated Frontend Anti-Patterns

AI code generators tend to repeat the same visual and structural mistakes. These ten anti-patterns appear constantly in LLM-produced Tailwind markup. Each section shows the flawed output, a corrected version, and a short explanation of why the fix matters.

---

## 1. Shadow Overuse

**Problem**: Every card, container, and panel gets `shadow-xl` or `shadow-2xl`, creating a muddy, floating-everything aesthetic with no visual hierarchy.

**Wrong:**
```html
<div class="grid grid-cols-3 gap-6">
  <div class="rounded-lg bg-white p-6 shadow-xl">
    <h3 class="font-semibold">Plan A</h3>
    <p class="text-gray-600">Basic features for individuals.</p>
  </div>
  <div class="rounded-lg bg-white p-6 shadow-xl">
    <h3 class="font-semibold">Plan B</h3>
    <p class="text-gray-600">Advanced tools for teams.</p>
  </div>
  <div class="rounded-lg bg-white p-6 shadow-xl">
    <h3 class="font-semibold">Plan C</h3>
    <p class="text-gray-600">Enterprise-grade security.</p>
  </div>
</div>
```

**Correct:**
```html
<div class="grid grid-cols-3 gap-6">
  <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <h3 class="font-semibold">Plan A</h3>
    <p class="text-gray-600">Basic features for individuals.</p>
  </div>
  <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <h3 class="font-semibold">Plan B</h3>
    <p class="text-gray-600">Advanced tools for teams.</p>
  </div>
  <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <h3 class="font-semibold">Plan C</h3>
    <p class="text-gray-600">Enterprise-grade security.</p>
  </div>
</div>
```

**Why**: Subtle `shadow-sm` with a light border provides structure at rest. Elevating to `shadow-md` on hover gives interactive feedback without making the entire page look like a stack of floating panels.

---

## 2. Inconsistent Spacing

**Problem**: Arbitrary pixel values like `p-[13px]` and `mt-[22px]` are scattered throughout a component, breaking the rhythm of the spacing scale and making maintenance difficult.

**Wrong:**
```html
<div class="p-[13px]">
  <h2 class="mb-[7px] text-xl font-bold">Account Settings</h2>
  <p class="mb-[22px] text-gray-600">Manage your preferences below.</p>
  <div class="mt-[18px] flex gap-[11px]">
    <button class="rounded bg-blue-600 px-[15px] py-[9px] text-white">Save</button>
    <button class="rounded border px-[15px] py-[9px]">Cancel</button>
  </div>
</div>
```

**Correct:**
```html
<div class="p-4">
  <h2 class="mb-1 text-xl font-bold">Account Settings</h2>
  <p class="mb-6 text-gray-600">Manage your preferences below.</p>
  <div class="mt-4 flex gap-3">
    <button class="rounded bg-blue-600 px-4 py-2 text-white">Save</button>
    <button class="rounded border px-4 py-2">Cancel</button>
  </div>
</div>
```

**Why**: Tailwind's 4px spacing scale (1 = 0.25rem, 2 = 0.5rem, 4 = 1rem, etc.) produces consistent vertical rhythm. Arbitrary values defeat the purpose of a utility system and make components look subtly uneven.

---

## 3. Missing Focus States

**Problem**: Buttons and links have hover styles but no `focus-visible` ring. Keyboard users see no indicator of which element is active.

**Wrong:**
```html
<button class="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
  Submit
</button>
```

**Correct:**
```html
<button class="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:bg-indigo-800">
  Submit
</button>
```

**Why**: `focus-visible` shows a ring only for keyboard navigation, not mouse clicks. Combined with `ring-offset-2` it creates a clear, accessible indicator. The `active` state provides tactile feedback on press.

---

## 4. Div Soup

**Problem**: Navigation, buttons, and structural landmarks are all `<div>` elements with click handlers. Screen readers cannot parse the page and keyboard navigation breaks entirely.

**Wrong:**
```html
<div class="flex items-center justify-between bg-white px-6 py-4 shadow">
  <div class="text-xl font-bold">Logo</div>
  <div class="flex gap-4">
    <div class="cursor-pointer text-gray-600 hover:text-gray-900" onclick="navigate('/')">Home</div>
    <div class="cursor-pointer text-gray-600 hover:text-gray-900" onclick="navigate('/about')">About</div>
    <div class="cursor-pointer rounded bg-blue-600 px-4 py-2 text-white" onclick="handleSignUp()">Sign Up</div>
  </div>
</div>
```

**Correct:**
```html
<nav class="flex items-center justify-between bg-white px-6 py-4 shadow" aria-label="Main navigation">
  <a href="/" class="text-xl font-bold">Logo</a>
  <div class="flex items-center gap-4">
    <a href="/" class="text-gray-600 hover:text-gray-900">Home</a>
    <a href="/about" class="text-gray-600 hover:text-gray-900">About</a>
    <button class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700" type="button">Sign Up</button>
  </div>
</nav>
```

**Why**: `<nav>`, `<a>`, and `<button>` carry built-in semantics, keyboard behavior, and screen reader announcements. A `<div>` with `onclick` has none of these and requires extensive ARIA work to approximate what native elements provide for free.

---

## 5. Z-Index Wars

**Problem**: Components use escalating arbitrary z-index values like `z-[999]` and `z-[9999]`, creating an unmanageable stacking context where new elements require even higher values.

**Wrong:**
```html
<div class="relative z-[100]"><!-- Dropdown --></div>
<header class="sticky top-0 z-[999]"><!-- Navbar --></header>
<div class="fixed inset-0 z-[9999]"><!-- Modal --></div>
<div class="fixed bottom-4 right-4 z-[99999]"><!-- Toast --></div>
```

**Correct:**
```html
<!-- z-10: Dropdowns and popovers -->
<div class="relative z-10"><!-- Dropdown --></div>

<!-- z-20: Sticky headers and sidebars -->
<header class="sticky top-0 z-20"><!-- Navbar --></header>

<!-- z-30: Modals and overlays -->
<div class="fixed inset-0 z-30"><!-- Modal --></div>

<!-- z-50: Toasts and system alerts -->
<div class="fixed bottom-4 right-4 z-50"><!-- Toast --></div>
```

**Why**: A four-level scale (10, 20, 30, 50) provides enough room for intermediate values while keeping numbers predictable. Arbitrary escalation is a sign that stacking contexts are not being managed properly.

---

## 6. Centering Everything

**Problem**: `text-center` is applied to entire cards or content blocks, causing body paragraphs, lists, and metadata to be center-aligned. This hurts readability for anything longer than a heading.

**Wrong:**
```html
<div class="rounded-lg border bg-white p-6 text-center">
  <h3 class="text-lg font-semibold">Monthly Report</h3>
  <p class="mt-2 text-gray-600">Your team completed 47 tasks this month across 12 projects. Performance improved by 18% compared to last month, driven primarily by faster code review turnaround times and fewer blocking dependencies.</p>
  <span class="mt-3 inline-block text-sm text-gray-400">Updated 2 hours ago</span>
</div>
```

**Correct:**
```html
<div class="rounded-lg border bg-white p-6">
  <h3 class="text-center text-lg font-semibold">Monthly Report</h3>
  <p class="mt-2 text-left text-gray-600">Your team completed 47 tasks this month across 12 projects. Performance improved by 18% compared to last month, driven primarily by faster code review turnaround times and fewer blocking dependencies.</p>
  <span class="mt-3 block text-left text-sm text-gray-400">Updated 2 hours ago</span>
</div>
```

**Why**: Centered text works for short headings and calls to action. Body paragraphs are significantly harder to read when centered because the eye cannot find a consistent start position for each line.

---

## 7. Arbitrary Values Abuse

**Problem**: Layouts are locked to exact pixel dimensions like `w-[347px]` and `h-[523px]`, producing rigid components that break on different screen sizes.

**Wrong:**
```html
<div class="flex gap-4">
  <aside class="h-[523px] w-[247px] bg-gray-50 p-4">
    <nav>Sidebar</nav>
  </aside>
  <main class="w-[847px] p-6">
    <div class="h-[312px] w-[347px] rounded bg-white p-4 shadow">
      <h2 class="text-lg font-bold">Dashboard</h2>
    </div>
  </main>
</div>
```

**Correct:**
```html
<div class="flex gap-4">
  <aside class="w-64 shrink-0 bg-gray-50 p-4">
    <nav>Sidebar</nav>
  </aside>
  <main class="min-w-0 flex-1 p-6">
    <div class="max-w-md rounded bg-white p-4 shadow">
      <h2 class="text-lg font-bold">Dashboard</h2>
    </div>
  </main>
</div>
```

**Why**: `flex-1`, `w-full`, `max-w-md`, and `shrink-0` create layouts that adapt to available space. Hard-coded pixel widths guarantee overflow or wasted space on any viewport that does not match the original design exactly.

---

## 8. Missing Dark Mode

**Problem**: Components are built exclusively with light background and dark text colors. Users who enable dark mode see either broken contrast or a blinding white card on a dark page.

**Wrong:**
```html
<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
  <h3 class="text-lg font-semibold text-gray-900">Notifications</h3>
  <p class="mt-1 text-gray-600">You have 3 unread messages.</p>
  <button class="mt-4 rounded bg-blue-600 px-4 py-2 text-white">View All</button>
</div>
```

**Correct:**
```html
<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
  <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
  <p class="mt-1 text-gray-600 dark:text-gray-400">You have 3 unread messages.</p>
  <button class="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400">View All</button>
</div>
```

**Why**: Adding `dark:` variants for background, text, and border ensures the component respects the user's system preference. The extra classes are a small cost for a universally usable interface.

---

## 9. Forgetting Transitions

**Problem**: Hover and focus states snap instantly between colors or shadows with no transition, producing a jarring, low-quality feel.

**Wrong:**
```html
<button class="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-800 hover:text-white">
  Settings
</button>
```

**Correct:**
```html
<button class="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 transition-colors duration-150 hover:bg-gray-800 hover:text-white">
  Settings
</button>
```

**Why**: `transition-colors duration-150` adds a subtle 150ms ease between color states. This single utility transforms a mechanical state change into a polished interaction. Use `transition-shadow` for shadow changes and `transition-all` sparingly when multiple properties animate together.

---

## 10. Desktop-First Responsive

**Problem**: Base styles target desktop widths, then `sm:hidden` or `lg:hidden` is used to strip things away on smaller screens. This inverts Tailwind's mobile-first design and produces bloated, fragile media queries.

**Wrong:**
```html
<div class="grid grid-cols-3 gap-8 lg:grid-cols-3 md:grid-cols-2 sm:grid-cols-1">
  <div class="block p-6 sm:hidden">
    <h3 class="text-xl">Feature A</h3>
    <p class="text-gray-600">Description for desktop users only.</p>
  </div>
  <div class="block p-6">
    <h3 class="text-xl">Feature B</h3>
  </div>
  <div class="block p-6 sm:hidden md:block">
    <h3 class="text-xl">Feature C</h3>
  </div>
</div>
```

**Correct:**
```html
<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
  <div class="hidden p-6 lg:block">
    <h3 class="text-xl">Feature A</h3>
    <p class="text-gray-600">Visible on large screens.</p>
  </div>
  <div class="p-6">
    <h3 class="text-xl">Feature B</h3>
  </div>
  <div class="hidden p-6 sm:block">
    <h3 class="text-xl">Feature C</h3>
  </div>
</div>
```

**Why**: Tailwind breakpoints (`sm:`, `md:`, `lg:`) apply upward from the specified width. Writing base styles for mobile and layering wider breakpoints on top means the smallest screen always works. The desktop-first approach fights the framework and leads to contradictory overrides.

---

## 11. Flat Dark Mode (No Surface Hierarchy)

**Problem**: Dark mode uses a single background color for everything — page, cards, modals, and dropdowns all share `bg-gray-900`. Without surface layers, there is no visual hierarchy and elements merge together.

**Wrong:**
```html
<!-- Everything is the same dark gray — no depth -->
<div class="min-h-screen bg-gray-900 text-white">
  <nav class="bg-gray-900 border-b border-gray-700 px-6 py-4">Navigation</nav>
  <main class="p-6">
    <div class="rounded-lg bg-gray-900 border border-gray-700 p-6">
      <h2 class="text-lg font-semibold">Card</h2>
      <p class="text-gray-400">Card merges into the page background.</p>
    </div>
  </main>
</div>
```

**Correct:**
```html
<!-- Three-level surface hierarchy creates depth -->
<div class="min-h-screen bg-gray-950 text-gray-100">
  <nav class="bg-gray-900 border-b border-gray-800 px-6 py-4">Navigation</nav>
  <main class="p-6">
    <div class="rounded-lg bg-gray-900 border border-gray-800 p-6">
      <h2 class="text-lg font-semibold text-gray-50">Card</h2>
      <p class="text-gray-400">Card is clearly elevated from the page.</p>
    </div>
  </main>
</div>
```

**Why**: Dark mode needs a surface layer system. Use 3 levels:
- **Base** (`bg-gray-950`): Page background — darkest
- **Surface** (`bg-gray-900`): Cards, panels, nav — one step lighter
- **Elevated** (`bg-gray-800`): Modals, dropdowns, tooltips — another step lighter

Each level is subtly lighter, creating depth without shadows. Never use pure `bg-black` — it creates excessive contrast and eye strain.

### Additional Dark Mode Rules

- **Desaturate accent colors**: Use `dark:bg-blue-500` or `dark:text-blue-400` instead of `dark:bg-blue-600`. Bright saturated colors on dark backgrounds are harsh.
- **Reduce font weight appearance**: Light text on dark backgrounds appears visually heavier. Consider `dark:font-normal` where you use `font-medium` in light mode.
- **Borders over shadows**: Use `dark:border dark:border-gray-800` instead of shadows for element separation. Shadows are nearly invisible on dark surfaces.
- **Image handling**: Add `dark:brightness-90` to images to prevent them from being blindingly bright on a dark page.

---

## 12. Ignoring prefers-reduced-motion

**Problem**: Animations play regardless of the user's OS-level "reduce motion" setting. This can cause discomfort or nausea for users with vestibular disorders.

**Wrong:**
```html
<div class="animate-bounce">
  <svg>Scroll down icon</svg>
</div>
<div class="hover:-translate-y-2 hover:shadow-xl transition-all duration-300">
  Card with movement on hover.
</div>
```

**Correct:**
```html
<div class="motion-safe:animate-bounce">
  <svg>Scroll down icon</svg>
</div>
<div class="
  hover:shadow-md transition-shadow duration-200
  motion-safe:hover:-translate-y-0.5 motion-safe:transition-all
">
  Card: shadow change always, movement only when allowed.
</div>
```

**Why**: The `motion-safe:` prefix ensures animations only play when the user's OS allows motion. The `motion-reduce:` prefix provides alternatives for reduced-motion users. Color and opacity changes are generally safe; position and scale changes should always be gated behind `motion-safe:`.
