# Frontend Design Guidelines

## 1. Scope and Adoption

These rules apply to every new frontend screen and to any existing screen that is materially redesigned. They govern application chrome, route views, forms, dialogs, tables, lists, filters, empty states, and feedback surfaces.

Existing untouched screens do not need a one-shot visual migration. When a feature is changed, move the affected surface toward this specification without introducing a second competing component style.

The warehouse frontend is an operational business tool. Optimize for scanning, comparison, repeated action, compact clarity, and predictable behavior rather than marketing presentation.

## 2. Component Foundation: shadcn-vue

### Technology fit decision

The Vue application must use **shadcn-vue** as its shared component foundation. In
project discussion and task requirements, the short name `shadcn` means shadcn-vue,
not the React implementation.

This decision matches the current Vue 3, Vite, TypeScript, and `@lucide/vue` stack.
The current application uses scoped CSS and does not yet include Tailwind CSS or an
`@` source alias, so adoption must be incremental:

- Add `tailwindcss` and `@tailwindcss/vite` when the first shadcn-vue component is
  implemented.
- Configure the `@` alias to resolve to `apps/web/src` in both Vite and TypeScript.
- Add `components.json` at `apps/web/components.json` when using the shadcn-vue CLI.
- Configure the CLI aliases so generated UI primitives resolve under
  `apps/web/src/components/ui` and shared utilities under `apps/web/src/lib`.
- Import Tailwind through the existing global stylesheet entry. Keep existing scoped
  feature CSS working during the transition.
- Do not perform a repository-wide CSS rewrite merely to adopt shadcn-vue. Migrate a
  control when its screen is materially changed or when the shared primitive is first
  needed.

Do not add PrimeVue, Element Plus, Naive UI, Vuetify, or another complete component
suite alongside shadcn-vue without a separate architecture decision. Two competing
component systems create inconsistent interaction, tokens, and maintenance ownership.

### Usage contract

- Generate source-owned UI primitives under `apps/web/src/components/ui` and keep them reviewable in the repository.
- Treat generated code as project code: review it, pin its dependencies, and adapt its
  tokens and variants to this specification instead of accepting registry defaults
  blindly.
- Verify generated state selectors against the project's actual CSS setup. Prefer
  explicit `data-[state=active]` and `data-[orientation=horizontal]` selectors over
  registry-specific aliases that are not configured here. Typecheck does not prove
  that a generated layout or state style exists in the compiled CSS.
- Use shadcn components for standard controls before creating a custom equivalent:
  `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Dialog`, `Sheet`,
  `Tabs`, `Table`, `DropdownMenu`, `Tooltip`, `Form`, `Alert`, `Skeleton`, `Badge`,
  `Separator`, and `ScrollArea`.
- Continue using Lucide icons through `@lucide/vue`. Do not introduce a second general-purpose icon family.
- Extend shadcn variants and tokens when domain behavior requires it. Do not copy a component into a feature folder merely to change spacing or color.
- Custom components are appropriate for domain-specific structures such as the ring-size inventory matrix, request-item editor, or warehouse workflow timeline. Build them from shadcn primitives where practical.
- Do not wrap every shadcn primitive in another bordered component. The component library is a foundation, not a reason to multiply containers.
- Preserve keyboard behavior, focus visibility, labels, disabled/loading states, and ARIA semantics supplied by the primitive.

Before a substantial new UI feature begins, configure shadcn-vue and its design tokens
if the repository does not yet contain `components/ui`. Installing the foundation does
not authorize an unrelated full-application restyle.

## 3. Visible Text: Functional Copy Only

Do not add visible descriptive or promotional text elements during normal feature implementation. Explanatory copy can be added later as a separate, inexpensive content pass when product intent is available.

### Prohibited visible copy

- Paragraphs beneath page titles that explain what the page does.
- Card descriptions that repeat the card title, status, or obvious control behavior.
- Feature marketing, slogans, value propositions, onboarding tours, tutorial blocks, and generic tips.
- Decorative eyebrow text, motivational phrases, or labels such as `快速开始`, `轻松管理`, or `一站式体验`.
- Instructions that merely narrate visible controls, such as `请在下方选择商品并点击提交`.

### Required functional copy

The prohibition does not remove text required to operate or understand the system. Keep the following concise and visible when applicable:

- Page and dialog titles.
- Field labels, table headers, button labels, menu items, values, quantities, dates, and status names.
- Validation errors, API errors, confirmation prompts, destructive-action reasons, success feedback, and loading states.
- Empty states that state the fact and, when available, provide one next action.
- Safety, compliance, synchronization, permission, and irreversible-action notices.
- Accessible names, `aria-label`, `aria-describedby`, `sr-only` text, and tooltips for unfamiliar icons.

Prefer `待审核申请 3` over a paragraph explaining that the queue contains requests waiting for review. Prefer `暂无待发放申请` plus a refresh action over a decorative empty-state essay.

## 4. Color, Theme, and Typography

### Base direction

- Use neutral white and cool neutral gray surfaces with restrained semantic accents.
- Existing green/teal operational accents are acceptable when contrast passes. Red, amber, and green should primarily communicate destructive, warning, and success states.
- Orange may appear as a semantic warning or status color, but must not become the brand-wide accent on a cream background.
- Do not use decorative gradients, blurred color blobs, bokeh, or color-orb backgrounds.
- Avoid a one-note interface dominated by variations of one hue.

### Forbidden theme directions

- No dark mode dominated by blue, indigo, violet, purple, or navy surfaces and glows.
- No Claude-like visual language: cream, beige, sand, or warm off-white foundations combined with warm orange/terracotta accents and retro serif headings.
- No retro editorial typography for application headings. Application chrome, controls, tables, and headings use the established neutral sans-serif stack.
- No colored shadow glow used as a substitute for hierarchy.

If dark mode is introduced later, start with neutral charcoal/black/gray surfaces, preserve semantic colors, and verify contrast independently. Dark mode is not required by this specification.

## 5. Radius, Cards, Borders, and Shadows

### Radius

- Standard controls use a restrained radius in the 4-6px range.
- Cards and framed tools must not exceed 8px radius.
- Do not use large `rounded-xl`, `rounded-2xl`, `rounded-3xl`, or pill-shaped containers for ordinary panels.
- Fully circular treatment is reserved for avatars, status dots, radio controls, and icon geometry that is conventionally circular.

### Cards and containment

- Use cards only for repeated entities, modal/dialog content, or genuinely framed tools.
- Do not place cards inside cards.
- Do not turn every page section into a floating card. Prefer unframed sections, full-width work areas, dividers, aligned columns, tables, and background changes.
- A border must communicate a real ownership, interaction, grouping, or state boundary. Do not border every field row, label group, toolbar segment, or nested subsection.
- Do not combine a page border, section border, card border, and inner bordered panel without a specific interaction reason for each layer.

### Shadows

- Default surfaces use no shadow.
- `shadow-sm` is the normal maximum for a raised static surface.
- `shadow-md` is reserved for temporary floating layers such as dialogs, dropdowns, and popovers.
- Avoid large blur radii, stacked shadows, colored shadows, and permanent elevation on every card.
- Prefer spacing, typography, separators, and surface contrast before adding a shadow.

## 6. Layout and Control Density

- Build the usable application as the first screen; do not add a landing-page hero before operational workflows.
- Keep headings proportional to their container. Route titles are clear but not hero-sized; compact panels use compact headings.
- Use stable grid tracks, explicit min/max widths, and overflow containers for tables or matrices so labels and dynamic data cannot resize the page unexpectedly.
- Use familiar icons for icon actions, segmented controls for compact modes, toggles or checkboxes for binary settings, selects/menus for option sets, and text buttons for explicit commands.
- Icon-only buttons require a tooltip and accessible name. Do not replace a familiar icon with a rounded text pill.
- Keep primary actions visually clear, but do not create multiple competing accent buttons in one region.
- The document must not horizontally overflow at the supported mobile viewport. Wide tables and matrices may scroll inside their own bounded region.

## 7. Review Gate

Every frontend review must verify:

- Standard controls use shadcn-vue or a documented domain-specific component.
- No new visible descriptive, promotional, tutorial, or redundant helper copy was added.
- Functional labels, errors, statuses, confirmations, and accessibility text remain present.
- The palette is neither blue-purple dark mode nor cream/orange/retro-serif Claude styling.
- Card radius is at most 8px; ordinary panels do not use large rounded containers.
- There are no nested cards or unexplained layers of borders.
- Static surfaces use no shadow or restrained `shadow-sm`; stronger elevation is limited to floating layers.
- Desktop and mobile screenshots show no text clipping, incoherent overlap, document-level horizontal overflow, or decorative empty space that displaces work.
- Keyboard focus, contrast, disabled/loading states, error states, long text, and empty data are visibly usable.

### Wrong

```vue
<section class="rounded-3xl border bg-[#f7f0e6] p-8 shadow-xl">
  <p class="font-serif text-3xl text-orange-700">轻松开启高效仓储体验</p>
  <div class="mt-6 rounded-2xl border p-6 shadow-md">
    <div class="rounded-xl border p-4">...</div>
  </div>
</section>
```

### Correct

```vue
<section class="space-y-4">
  <header class="flex items-center justify-between border-b pb-3">
    <h1 class="text-xl font-semibold">待审核申请</h1>
    <Button>刷新</Button>
  </header>
  <Table>...</Table>
</section>
```

The correct version exposes the task immediately, uses functional text, and creates hierarchy without nested cards or decorative elevation.
