# BudgetWise (Client-Side)

BudgetWise is a mobile-first, offline-ready budgeting companion that follows the 50/30/20 method and embraces Apple-inspired interaction patterns. The entire experience runs on the client with `localStorage` for persistence, so no authentication or backend services are required.

## Feature highlights

- Offline single-page app with Dashboard, Add, Activity, Categories, and Settings panels
- Instant 50/30/20 budgeting cards that react to new income or expenses
- Quick Log templates for one-tap recurring expenses, plus long-press custom amounts
- Import/Export JSON workflow for full data portability or device migration
- Month switching, infinite scrolling activity feed, undo for deletions, and toast feedback
- Optional advanced charts (donut and horizontal bar) powered by lazily loaded Chart.js
- Accessibility-aware layout: safe areas, focus styles, aria-live toasts, and prefers-reduced-motion support

## Project layout

- `index.html` - single-page shell wired for the primary navigation tabs
- `styles.css` - mobile-first design system with dark mode, bucket theming, and tab-bar ergonomics
- `app.js` - storage layer, state management, UI flows, dialogs, and import/export logic
- `charts.js` - lazy Chart.js bootstrap with bucket and category chart rendering
- `icons/` - monochrome SVG glyphs used by the tab bar and header actions
- `manifest.json` - basic PWA manifest (service worker optional and not yet included)

## Local storage schema (v1)

Key | Description
--- | ---
`BW_V1_SETTINGS` | `{ currency, locale, rule:{necessities, leisure, savings}, firstDayOfWeek, showAdvancedCharts, hapticFeedback, schema_version }`
`BW_V1_CATEGORIES` | `[{ id, name, bucket, archived }]`
`BW_V1_TRANSACTIONS` | `[{ id, type, amount_cents, description, category_id, bucket, date_iso }]`
`BW_V1_RECURRING` | `[{ id, description, default_amount_cents, category_id }]`

Amounts are stored in integer cents, IDs are timestamp-based for deterministic ordering, and ISO-8601 timestamps drive month-based queries. Corruption detection surfaces a toast prompting the user to reset or import a backup.

## Usage

1. Open `index.html` in any modern browser (mobile viewport 320-414px is the primary target).
2. Add income to seed the 50/30/20 calculations, then log expenses with or without categories.
3. Use the Settings panel to adjust currency, locale, rule percentages, and chart or haptic toggles.
4. Manage recurring templates from Dashboard → Quick Log → Manage, or via Settings.
5. Export data from the header action; import JSON via Settings → Import data.

## QA checklist snapshot

- Smoke navigation across Dashboard/Add/Activity/Categories/Settings without console errors.
- 50/30/20 math: with 1,000 income budgets should display 500 / 300 / 200.
- Expense logging with and without categories updates dashboards and activity instantly.
- Category CRUD enforces archive vs delete, updates pickers and bucket stats.
- Quick Log tap plus long-press behaviors create or customise transactions with undo feedback.
- Month switch resets totals appropriately; Activity list paginates with Load more.
- Import/export round trips reproduce totals and lists exactly; corrupted storage prompts recovery.
- Currency and locale settings reformat all amounts; chart visibility respects the advanced toggle and data presence.

Run the full release checklist from the project brief before shipping to confirm ergonomics, accessibility, dark mode, and offline readiness.
