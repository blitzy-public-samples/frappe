# PR Description — ToDo Analytics Dashboard refinement

## 1. Summary

This document is the pull-request description for the refinement of the ToDo Analytics Dashboard
delivery on branch `blitzy-2add1b35-3745-43e2-944e-dbba0015c106`. It carries the reviewable record the
review feedback asked for: the user-visible behaviour changes and release notes (§2), every file changed
outside the twelve shared framework files listed in the Project Guide's Section C (§3), the accessibility
checks that automated tests cannot cover and a person must still run with a screen reader (§4), the
`allow_cors: "*"` audit (§5), the decision log required by Rule 1 — Explainability (§6), and the test
evidence for each change (§7).

The refinement is split into work units, one per review directive. Each unit writes under its own
sub-heading in the sections that concern it, so a section holds one entry per unit rather than a single
merged narrative. The units and the directives they implement:

| Unit | Directive | Change |
| --- | --- | --- |
| A | D3, D10.1 | Chart axis tick formatting (thousands separators, no floating-point artifacts, exact abbreviations) and width-aware axis label density in `frappe/public/js/frappe/utils/utils.js` and `frappe/public/js/frappe/widgets/chart_widget.js`. |
| B | D4, D10.2 | Time-window control lifecycle of the chart widget: re-render on every selection, no state shared between widget instances, focus restored to the triggering control. |
| C | D5, D10.3 | Chart error-state recovery: an in-widget Retry control that re-fetches the data and hides the error on success. |
| D | D6.a/b/d, D10.4, D10.9 | Keyboard-operable widget menus, focus restored after a menu closes, applied option programmatically marked (`menuitemradio` / `aria-checked`). |
| E | D6.c, D10.5 | Plot-area tooltips reachable from the keyboard on both dashboard charts, with a live-region announcement. |
| F | D7, D10.6 | WCAG AA contrast tokens on Desk dashboard/widget surfaces (focus ring, placeholder, error text, breadcrumbs) in `frappe/public/scss/desk/desktop.scss`. |
| G | D8, D10.7 | Number Card tile hover/focus affordance and keyboard operability. |
| H | D9, D10.8 | Empty dynamic filter values no longer written into a widget's filter state (`frappe/public/js/frappe/utils/dashboard_utils.js`). |
| I | D11, D13 | CSRF token minted at API login, fail-closed rejection for token-less cookie sessions, `allow_cors: "*"` audit and tightening, shipped Python client sends the token. |
| J | D12 | Security response-header baseline (`X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`) in `frappe/app.py`. |
| K | D1, D2, D14 | Scope verification against the review's exclusions, the merged-tree regression run, and this document's §1/§2/§3 consolidation. |

**Directive by directive.** Every change below is on branch
`blitzy-2add1b35-3745-43e2-944e-dbba0015c106`; Units A–J landed together in commit `811ceb2cc3`
("fix(desk,auth): refine ToDo Analytics dashboard widgets and harden CSRF and response headers") on top
of the pre-refinement delivery `932cb6aae4`, and Unit K's verification and this document's consolidation
follow in the `docs(desk)` commit.

- **D1 — scope guard. Verified, nothing reverted.** All 43 paths in `git diff --name-status
  a8824d994f..HEAD` fall into exactly three groups: the twelve Section C framework files, the eighteen
  files of the feature's original delivery, and the thirteen additional paths listed in §3. Every area the
  review excluded is untouched by the refinement: `frappe/utils/dashboard.py` (`cache_source`, the chart
  data caching behind the HTTP 508 case), `frappe/desk/doctype/dashboard_chart/dashboard_chart.py` (the
  `last_synced_on` write), the two chart-source modules' caching (the whole
  `frappe/desk/dashboard_chart_source/` tree is absent from the refinement's diff), `pyproject.toml`,
  `package.json`, `yarn.lock`, `.github/**` (no dependency-advisory or CI-gate work),
  `frappe/patches.txt`, `frappe/hooks.py`, and `blitzy/documentation/Project Guide.md` (no decision-log
  or test-inventory reconciliation — the refinement's own decisions live in §6 of this document
  instead). No out-of-scope hunk was found, so no revert was needed.
- **D2 — no regression. Verified on the merged tree** (bench with assets rebuilt, `migrate` run, web
  server up): the 40 protected Python tests pass — 17 in
  `frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed`, 14 in
  `…todo_top_owners.test_todo_top_owners`, 9 in `frappe.tests.test_todo_analytics_dashboard` — and
  `cypress/integration/todo_analytics_dashboard.js` passes 10 of 10 `it` blocks, its original
  "renders two cards and two charts" case included. The framework modules the refinement touches also
  pass: `test_auth` 3 + 32, `test_api` 47, `test_cors` 4, `test_frappe_client` 14,
  `test_security_headers` 19, `test_api_v2` 44, `test_oauth20` 8, `test_website` 24,
  `web_form.test_web_form` 36, `test_number_card` 5, `test_dashboard_chart_source` 7,
  `test_dashboard_chart` 11, `test_dashboard` 1, `test_todo` 6 — 301 Python tests in total, every module
  `OK`. Every test file was extended, never replaced; the only removals are the two renamed,
  expectation-flipped fail-open cases the CSRF directive required (see the O-5 note in §2 and rows RI-3
  and RI-7). Full commands and counts are in §7 under "Unit K — merged-tree regression".
- **D3 — axis label density and number formatting (Unit A).** `frappe/public/js/frappe/utils/utils.js`
  gains `frappe.utils.format_chart_axis_number` (site group separator, at most two decimals for a
  magnitude of one or more, binary noise rounded away, abbreviations only where exact) and a width-aware
  `set_space_label_ratio`;
  `chart_widget.js` measures the plot width, derives the label stride, re-applies it on a debounced
  resize and routes the values printed over points through the same formatter. Rows RA-1 … RA-5.
- **D4 — time-window control lifecycle (Unit B).** In `chart_widget.js` (with helpers in
  `dashboard_utils.js`) every timespan, interval and date-range selection issues exactly one fetch with
  the selected arguments and redraws, responses are sequence-checked so a superseded one cannot
  overwrite a newer, the chart document and the per-user chart settings are copied per widget so two
  widgets never share state, and focus returns to the control the selection was made from. Rows
  RB-1 … RB-9.
- **D5 — chart error-state recovery (Unit C).** The error container in `chart_widget.js` now holds a
  `role="alert"` message and a keyboard-operable `button.chart-retry` that re-fetches through the same
  path the controls use (`refresh: 1`) and hides the error on success, with a focus ring added in
  `desktop.scss`. Rows RC-1 … RC-8.
- **D6 — keyboard and ARIA residuals (Units D and E).** Widget menus are keyboard-operable with focus
  returned to the toggle on every close path, the applied option is marked programmatically
  (`role="menuitemradio"` with `aria-checked`), the Card Actions toggle is a native button, and each
  chart's plot area is focusable with arrow/Home/End/Enter/Escape tooltip navigation announced through a
  per-widget live region. Rows RD-1 … RD-9 and RE-1 … RE-11.
- **D7 — WCAG AA contrast tokens (Unit F).** `frappe/public/scss/desk/desktop.scss` overrides
  `--focus-default`, `--focus-outline-default` and `--placeholder-color` and the placeholder, extra-muted,
  danger and breadcrumb colours, scoped to the Desk dashboard and widget surfaces in both themes. The
  four failures named in the review (focus ring 1.56:1, placeholder 3.93:1, error text 4.16:1,
  breadcrumbs 4.17:1) and two more found while measuring on the same surfaces (the date-range input
  placeholder at 2.57:1 light / 1.45:1 dark, and the light-theme breadcrumb separator at 2.85:1) now meet
  AA; no global token was changed. Rows RF-1 … RF-9.
- **D8 — Number Card tile hover affordance (Unit G).** `number_card_widget.js` applies the framework's
  existing `widget-shadow` class and makes the tile a named, keyboard-operable `role="link"` with
  `:hover`, `:focus-visible` and `:focus-within` parity in `desktop.scss`. Rows RG-1 … RG-4.
- **D9 — empty filter write (Unit H).** `frappe.dashboard_utils.is_unset_filter_value` defines "unset"
  and `get_all_filters` omits such dynamic filters from both the list- and dict-shaped filter state
  while preserving `0` and `false`. Rows RH-1 … RH-6.
- **D10 — coverage for every change (Units A–H, J; D10.9 Units D–G).** Nine `it` blocks were appended to
  `cypress/integration/todo_analytics_dashboard.js`, one per change, and the checks a browser test
  cannot make are listed in §4: what a screen reader actually announces (§4.1) and what a computed style
  cannot prove about the painted result (§4.2).
- **D11 — CSRF coverage (Unit I).** `frappe/sessions.py` mints the session's token at creation,
  `frappe/auth.py` exposes it in the `POST /api/method/login` response and fails closed for token-less
  cookie sessions without same-site evidence, and `frappe/frappeclient.py` sends
  `X-Frappe-CSRF-Token`; tests were added to `test_auth.py`, `test_api.py` and `test_frappe_client.py`.
  Rows RI-1 … RI-8, RK-1, RK-2.
- **D12 — security response-header baseline (Unit J).** `frappe/app.py::process_response` applies
  `X-Frame-Options`, a Desk-tuned `Content-Security-Policy`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy` with `setdefault`, overridable per site, covered by the new
  `frappe/tests/test_security_headers.py`. Rows RJ-1 … RJ-10.
- **D13 — `allow_cors: "*"` audit (Unit I).** The wildcard no longer exempts a request from CSRF, an
  enumerated origin still does, and every retained `"*"` is documented with its reason in §5. Rows RI-3
  and RI-9 … RI-11.
- **D14 — flag files outside the twelve (Unit K).** §3 lists all nine paths changed or added outside the
  twelve Section C files and outside the feature's own eighteen, each with its directive and the reason
  it was necessary, plus the Project Guide §5.2 maintainer sign-off note and a second table naming the
  eight Section C files this refinement reopened.

## 2. Behaviour changes and release notes

What a user or an operator notices after this refinement, one sub-section per unit. The Desk changes
(Units A–H) are visual and interaction changes on dashboard and widget surfaces and need no migration:
charts label their axes legibly and format numbers consistently, the time-window controls redraw
reliably and keep the keyboard where the user left it, a failed chart offers Retry instead of a page
reload, every widget menu and both plot areas are operable from the keyboard with the applied option
announced, Desk dashboard surfaces meet WCAG AA contrast, Number Card tiles respond to hover and focus,
and a dynamic filter that resolves to nothing is dropped rather than sent as `null`. The security
changes (Units I and J) alter server behaviour and carry the only breaking change in this refinement —
an unsafe request on a token-less cookie session that presents no same-site evidence is now rejected —
together with four new response headers that an operator can override per site. Each sub-section states
the change, what an operator must do about it, and the AAP sections the review's directives overrode
(O-1 to O-5 in the adjudication record): editing the shipped framework files, adding markup, ARIA and
SCSS of the feature's own, extending the error container with a control, changing the login response and
the CSRF and CORS posture, and growing the test files beyond their planned inventory are all directed by
the review and are listed in §3 for maintainer sign-off.

### Unit A — axis density and number formatting

- Chart y-axis ticks rendered through `frappe.utils.format_chart_axis_number` now read `0`, `250`,
  `1,250`, `0.3`, `1 K`, `1.5 M`: the site number format's group separator below the abbreviation
  threshold, at most two decimals for a magnitude of one or more with binary representation noise removed
  (never `100.00` or `0.30000000000000004`; a smaller magnitude carries the decimals three significant
  digits need, so `0.015` prints `0.015` — RA-2), and a number-system abbreviation (K/M/L/Cr) only when it
  carries the value exactly. The `(label, country)` signature and string return type are unchanged, so every Desk consumer of
  the helper (report view, query report, form dashboard) gets the same formatting.
- The x-axis label-space ratio is derived from the measured plot width instead of a fixed
  `labels.length > 10` rule, so labels neither overlap nor collapse into duplicates at common viewport
  widths; the chart widget recomputes it on a debounced window resize.
- Values printed over data points (`valuesOverPoints`) are rewritten through the same axis formatter so
  bars and axis agree.

### Unit B — time-window control lifecycle

**Chart time-window controls (Desk dashboards, workspaces and any page using the chart widget).**

- Selecting a timespan or an interval — including re-selecting the value already shown — now fetches the
  chart data for the selected window and redraws the axis. Previously a timespan selection could send a
  `time_interval` of `null` while the label read `Daily`, and re-selecting the displayed value did nothing.
- A selection now persists the effective `timespan` and `time_interval` pair together, so the visible
  `.filter-label`, the request arguments and the per-user Dashboard Settings `chart_config` entry always
  agree. `Reset Chart` clears the saved entry, drops any date-range selection and re-reads the chart
  record's own `timespan`/`time_interval`.
- A response that is no longer the latest in-flight request for a widget is discarded, so a fast second
  selection can no longer be overwritten by the earlier response.
- Each widget now holds its own copy of the Dashboard Chart document and of its `chart_settings`, so
  rendering one widget no longer mutates the client model cache or another widget's settings. Two widgets
  showing the same chart keep independent windows in one page session; per-user persistence remains keyed
  by chart name, as before.
- After a selection that re-renders the chart, focus returns to the dropdown toggle that was used (or
  stays in the date-range input for `Select Date Range`); when the action area is rebuilt by `Refresh` or
  `Reset Chart`, focus returns to the equivalent control in the rebuilt action area instead of always
  falling back to the chart menu.
- Switching away from `Select Date Range`, refreshing, resetting or deleting a widget now removes that
  widget's date-range control and datepicker instead of hiding it, so repeated use no longer leaves
  orphaned controls behind.

### Unit C — error-state recovery

- A Dashboard Chart widget whose data call fails now shows the failure inside the widget instead of hanging on
  "Loading…": the error container renders the server's message plus a **Retry** button. Activating Retry
  re-fetches the chart data (with `refresh: 1`) and, on success, hides the error and draws the chart — no page
  reload is needed. On repeated failure the error state simply returns, with the same single Retry control.
- Previously the widget's error handler read `err._server_messages` unconditionally. The framework's request
  layer calls that handler with no argument for HTTP 401/403/404/413/500/502/504/508, so the handler threw a
  `TypeError`, the error container stayed empty and hidden, and the widget was stuck on "Loading…" until the
  user reloaded. The handler now derives a message from whatever is available and never throws.

### Unit D — widget menus (keyboard, focus and ARIA)

- Every Desk widget menu — chart actions, Number Card actions, and the timespan, time-interval and
  heatmap-year dropdowns of a chart widget — is now fully operable from the keyboard. Enter, Space and
  ArrowDown on the control open its menu and move focus to the first option (ArrowUp opens it on the last
  option); ArrowDown and ArrowUp move between options and wrap around; Home and End jump to the first and
  last option; Enter and Space activate the focused option; Escape closes the menu; Tab and Shift+Tab
  close it and let focus continue along the page's own tab order.
- Whenever a widget menu closes — by Escape, by a click outside it, by activating an option, or
  programmatically — focus returns to the control that opened it instead of being dropped on the page
  body. Focus that the activated action moved on purpose (a dialog that opened, a route that changed) is
  left where the action put it.
- The Number Card "Card Actions" control is now a `<button>` instead of a link with `role="button"`. Its
  CSS selector (`.card-actions [data-toggle="dropdown"]`), its accessible name and its tab stop are
  unchanged; its appearance is unchanged.
- The applied option of a single-selection widget dropdown (timespan, time interval, heatmap year) is now
  announced as the checked option of a radio menu (`role="menuitemradio"` with `aria-checked="true"`),
  not only shown as the control's own label, and it is additionally highlighted with Bootstrap's
  `.active` class.
- Every widget menu is named after the control that opens it (`role="menu"` plus `aria-labelledby`), and
  the chart "Set Filters" control now declares that it opens a dialog (`aria-haspopup="dialog"`) rather
  than a menu. Focus returns to it after that dialog (or, for document-type charts, its filter popover)
  closes.

### Unit E — plot-area tooltips reachable from the keyboard

- Both dashboard charts ("ToDo Created vs Completed" and "ToDo Top Owners") now expose their plot area as a
  single focus stop (`tabindex="0"`, `role="group"`) labelled "<chart name> chart. Use the arrow keys to read
  values.". It is the last tab stop inside each chart widget, after that widget's own head controls.
- With the plot area focused, <kbd>→</kbd> / <kbd>←</kbd> move one data point at a time (clamped at both
  ends), <kbd>Home</kbd> / <kbd>End</kbd> jump to the first / last data point, <kbd>Enter</kbd> and
  <kbd>Space</kbd> re-show the current point and <kbd>Esc</kbd> hides the tooltip. Moving focus away hides it
  too. The tooltip shown is the same `.graph-svg-tip` the pointer shows, at the same position.
- Every keyboard move also writes the tooltip's title and values into a visually hidden
  `aria-live="polite"` region inside the widget (for example "09-21-2026: Created 4, Completed 0" or
  "Administrator: Open ToDos 3"), so a screen-reader user hears what a sighted user sees.
- No other key is intercepted: <kbd>Tab</kbd> still moves focus on, <kbd>↑</kbd> / <kbd>↓</kbd> keep their
  default behaviour, and the chart and card menus still open with <kbd>↓</kbd> on their toggle. The existing
  mouse tooltip behaviour on both charts is unchanged.

### Unit F — WCAG contrast

On the Desk dashboard and on any Desk surface built from widgets, four colours change:

- The keyboard focus ring on widget controls is `var(--ink-gray-6)` instead of the near-white
  `#c9c9c9e5` (light) / `#464646cc` (dark). It keeps its existing 2px light / 3px dark
  geometry, so only the colour is darker in light mode and lighter in dark mode.
- Placeholder text inside widgets — both `input::placeholder` and the chart loading /
  "No Data" state — is `var(--ink-gray-6)`, the same value as `--text-muted`.
- Chart error text is `var(--ink-red-8)` instead of `#e03636`.
- Breadcrumb links on the `dashboard-view` route are `var(--ink-gray-6)`, and their `/`
  separator is `var(--ink-gray-5)`.

No API, no markup and no user-visible copy changes. Nothing outside these surfaces is
affected; the focus ring on every other Desk page is untouched.

### Unit G — Number Card tile hover affordance

- **Number Card tiles are now focusable and keyboard-operable (Unit G, D8).** Every Number Card tile
  (`.number-widget-box`, rendered on Dashboard pages and on Workspaces) carries `role="link"`,
  `tabindex="0"` and an accessible name derived from the card's type and destination — `"<card title>: open
  the <doctype> list"`, `"<card title>: open <single doctype>"`, `"<card title>: open the <report> report"` or
  `"<card title>: open <route>"` for a Custom card; a card with no destination carries none of the three
  attributes (RG-2) — and Enter or Space performs the same navigation as clicking the tile. The tiles therefore add one tab stop each to the tab order of
  any page that renders them, immediately before their existing "Card Actions" menu trigger. Tiles rendered
  in workspace customize (edit) mode are deliberately left out of the tab order, matching shortcut tiles.
- **Number Card tiles gain a hover and focus treatment (Unit G, D8).** On hover, on `:focus-visible` and on
  `:focus-within` the tile border darkens and the tile is elevated with `var(--shadow-base)`; on
  `:focus-visible` it additionally shows the `var(--focus-default)` focus ring with the UA outline
  suppressed. Both transition over 0.2s. No colour token is redefined.

### Unit H — dynamic filter empty write

- **Dashboard Chart / Number Card dynamic filters (Unit H, D9).** A dynamic filter whose JavaScript
  expression evaluates to an unset value is now omitted from the filter state instead of being sent as
  `null` (list-shaped filters) or written as a key with an `undefined` value (dict-shaped filters).
  Before this change a chart or card with, for example, `allocated_to = frappe.defaults.get_user_default("…")`
  on a site where that default is not set sent `["ToDo","allocated_to","=",null]` and therefore rendered
  `0` / a flat zero series even when matching rows existed. After this change the widget applies only
  the filters that actually resolved — the record's static filters plus the dynamic filters that
  evaluated to a value. Consequence to note for site owners: a widget whose *only* filter was an unset
  dynamic filter now shows the unfiltered aggregate rather than a false `0`.

### Unit I — CSRF

- `POST /api/method/login` now returns a `csrf_token` field. The session that login creates holds that
  token from the moment it is created, so it is the same value the Desk boot (`frappe.csrf_token`) and
  `frappe.sessions.get_csrf_token()` return for that session.
- API clients that authenticate with the session cookie must send the token as the `X-Frappe-CSRF-Token`
  header (or `csrf_token` in the request body) on `POST`, `PUT`, `PATCH` and `DELETE`. Browsers on the
  site itself are unaffected: a request that carries `Sec-Fetch-Site: same-origin`/`none`, or an `Origin`
  or `Referer` whose host is one of the site's hostnames, is still accepted when the session holds no
  token.
- **Breaking change.** An unsafe request on a token-less cookie session that carries no same-site signal
  at all — a non-browser client replaying a session cookie with no `Origin`, `Referer` or
  `Sec-Fetch-Site` — is now rejected with HTTP 400 `CSRFTokenError`. Before this change such a request
  was accepted. Sessions created before the upgrade hold no token; their clients must either send the
  token (obtainable by logging in again) or present a same-site signal.
- `allow_cors: "*"` no longer exempts a request from the CSRF check. An explicitly configured
  `allow_cors` origin (a string or a list of origins) remains an exemption, so named cross-origin
  integrations keep working. `allow_cors` response headers themselves are unchanged.
- Requests that are not authenticated by an ambient cookie are outside the CSRF check, exactly as
  before: Guest sessions, safe methods, sites with `ignore_csrf` set, an `sid` supplied in the body
  or query string, and a request whose `Authorization` credential — `Basic`, `token` or an OAuth
  `Bearer` token — authenticates the user the request runs as. An OAuth bearer token sets the
  request's user to the token's own user, so such a request is always that user's own;
  `api_key`/`api_secret` credentials do not replace a logged-in cookie user, so a key belonging to
  somebody else leaves the request running as the cookie's user and inside the check.
- A credential that does not authenticate exempts nothing, and what the caller sees is whatever
  rejected it. A well-formed but unknown `api_key`/`api_secret` pair is rejected by authentication
  itself with HTTP 401 `AuthenticationError`, and an undecodable `Basic` value with HTTP 400
  `InvalidAuthorizationToken`. A credential that authenticates nobody without raising — an unknown
  OAuth bearer token — and a valid key belonging to another user both leave the request rejected
  with HTTP 400 `CSRFTokenError`, as does an unsupported scheme such as `Negotiate`. The decision is
  settled inside `init_request`, before any `before_request` hook and before the endpoint (RI-4).
- The shipped Python client `frappe.frappeclient.FrappeClient` captures the login token and sends it on
  every subsequent request, so `insert`, `update`, `delete`, `submit` and the other write helpers keep
  working unchanged. A client built on `api_key`/`api_secret` alone never logs in, so it holds no
  session cookie and is unaffected; one given key credentials and a username and password together
  logs in as well, and then holds the token beside the `Authorization` header it already sends.
- **Operator migration guidance.** Upgrade order does not matter for browsers. For server-to-server
  integrations: update to this version of `FrappeClient` (no code change needed), or read `csrf_token`
  from the login response and send `X-Frappe-CSRF-Token` yourself, or switch the integration to
  `api_key`/`api_secret` authentication. Sites that set `allow_cors: "*"` should replace it with the
  explicit list of origins they trust. `ignore_csrf` remains available as a last resort and disables the
  check entirely.

### Unit J — security headers

Every dynamic response Frappe serves — Desk HTML pages, REST/RPC JSON, the login and website pages, file downloads and error pages, including `OPTIONS` preflights — now carries a baseline of four security headers, added in `frappe/app.py::process_response` through a new `set_security_headers()`:

| Header | Default value |
| --- | --- |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' ws: wss: https:; frame-src 'self' blob: https:; media-src 'self' data: blob: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'` |

Each header is applied with `setdefault`, so a header a renderer or an endpoint already set is kept: a Web Form with **Allowed Embedding Domains** keeps its own `frame-ancestors` policy, and `X-Frame-Options` is then omitted for that response because the header cannot express an allow-list. Headers set through `frappe.local.response_headers` during request processing continue to win, because the baseline is applied before that dictionary is merged; `X-Frame-Options` is decided from the policy that merge leaves in place — the per-request one when both layers set a `Content-Security-Policy` — and is kept whenever the effective `frame-ancestors` list resolves to the request's own origin, including when that origin is spelled out absolutely (`frame-ancestors https://site.example` on `https://site.example`).

**Shipped previews under the policy.** `object-src 'none'` forbids `<object>` and `<embed>`, so the File form now renders its PDF preview in a same-origin `<iframe>` (`frappe/core/doctype/file/file.js`, §3) instead of the `<object><embed>` pair it used before; `frame-src 'self'` covers it. The Print Format Builder builds its preview PDF as a `blob:` URL and assigns it to an iframe, which is why `frame-src` carries `blob:`.

**Per-site configuration.** Every header can be overridden in `site_config.json` / `common_site_config.json`:

| Key | Effect |
| --- | --- |
| `x_frame_options` | Replaces the `X-Frame-Options` value |
| `content_security_policy` | Replaces the whole policy string |
| `x_content_type_options` | Replaces the `X-Content-Type-Options` value |
| `referrer_policy` | Replaces the `Referrer-Policy` value |
| *any of the four set to `""` or `null`* | Omits that single header |
| `disable_security_headers: 1` | Omits all four headers (opt-out) |

**Operators should review two cases before upgrading.**

1. *Embedding Desk pages or web forms in an iframe on another origin.* The default `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` block it. Web Forms that already declare Allowed Embedding Domains keep working unchanged; for anything else, set `x_frame_options: ""` together with a `content_security_policy` whose `frame-ancestors` lists the embedding hosts.
2. *Sites loading third-party scripts, styles, fonts, images or XHR endpoints.* The default policy allows `'self'` plus any `https:` origin for scripts, styles, images, fonts, frames and connections (and `ws:`/`wss:` for realtime), which covers the CDN, avatar, flag, map-tile and analytics sources the framework itself uses. A site whose custom app loads assets over plain `http:`, from a non-`https:` scheme, or that needs stricter rules, overrides `content_security_policy` per site. When the development server serves the site (`DEV_SERVER=1`), the site's own socket.io origin is added to `connect-src` automatically so realtime keeps working on a `bench start` bench. An overriding policy gets the same treatment: the origin is appended to its `connect-src` when it has one, and otherwise a `connect-src` is synthesized from the policy's `default-src` sources plus that origin (so `default-src 'none'` yields a `connect-src` holding the socket.io origin alone). A policy that restricts neither directive places no limit on connections and is left exactly as configured.

No header is applied to static assets served by the WSGI static middleware or by nginx; those responses do not pass through the response layer.

## 3. Files changed outside the twelve Section C framework files

The twelve shared framework files this branch changes are listed in the Project Guide's Section C and
need maintainer sign-off before merge (Project Guide §5.2). The files below are changed or added *in
addition* to those twelve and are flagged here rather than proceeding silently, as the review feedback
requires. The same sign-off note applies to them.

The table is derived from `git diff --name-status a8824d994f..HEAD` on the merged tree rather than from
the units' own claims. Of the 43 changed paths, twelve are the Section C framework files (listed again
under this table), eighteen are the feature's own files added by the original delivery — the package
markers, records, server modules, client configs and collocated tests of the two chart sources under
`frappe/desk/dashboard_chart_source/`, the two `frappe/desk/dashboard_chart/todo_*` records, the two
`frappe/desk/number_card/todo_*` records, `frappe/desk/desk_dashboard/todo_analytics/todo_analytics.json`,
`frappe/tests/test_todo_analytics_dashboard.py` and `cypress/integration/todo_analytics_dashboard.js`,
which are the feature's own artefacts and need no flag — and the twelve rows below (plus the unchanged
Project Guide, listed for completeness) are everything else.

| Path | New or existing | Directive | Reason the change was necessary |
| --- | --- | --- | --- |
| `frappe/sessions.py` | Existing | D11 | `Session.start()` mints the session's CSRF token so a session created by `POST /api/method/login` holds one from creation, persisted by the session row's existing single insert. `Session.__init__` also records whether the `sid` came from the request body/query, which `frappe/auth.py` needs to keep explicit-`sid` requests outside the CSRF check. |
| `frappe/frappeclient.py` | Existing | D11 | The shipped Python client must send `X-Frappe-CSRF-Token`; without it every cookie-session write from `FrappeClient` would be rejected by the fail-closed check. |
| `frappe/tests/test_frappe_client.py` | Existing | D11 | Adds `test_client_sends_csrf_token_after_login`, the regression test for the client change above. |
| `frappe/tests/test_oauth20.py` | Existing | D11 | The authorization-code, PKCE, token-revocation and OpenID tests kept the resource owner's `sid` cookie in the test client while posting to the token and revocation endpoints as the OAuth client; under the fail-closed check that ambient cookie session, which sends no CSRF token, is rejected with 400. The four tests now drop the cookie before acting as the OAuth client (`FrappeRequestTestCase.forget_sid_cookie`, decision RK-1). |
| `frappe/tests/test_api_v2.py` | Existing | D11 | `test_add_comment_v2` and `test_delete_document_non_existing_v2` relied on the ambient cookie session the v2 harness login leaves in the shared test client; they now state their credential explicitly (`sid` in the request body / query string) like the rest of the module and the v1 tests (decision RK-2). |
| `frappe/app.py` | Existing | D12 | `process_response()` is the single response layer every dynamic response passes through (Desk HTML via `get_response()`, API JSON, downloads, well-known endpoints, `OPTIONS` and error responses). The four security headers cannot be added anywhere else without missing response paths. |
| `frappe/core/doctype/file/file.js` | Existing | D12 | The default `Content-Security-Policy` carries `object-src 'none'`, which forbids `<object>` and `<embed>`; the File form's `preview_file` rendered PDFs through that pair, so the preview would have been blocked on every site. Its markup is now a same-origin `<iframe>` with the same geometry and an escaped, translated `title`, covered by `frame-src 'self'` (decision RJ-3). No other preview branch and no other File behaviour changes. |
| `frappe/tests/test_security_headers.py` | New | D12 | Coverage for the header baseline: default values, the Desk-compatible policy, renderer/`response_headers` precedence, the per-site overrides and opt-out, presence on Desk page, dashboard, API, login and web-form responses, and presence on a CORS response for a site with `allow_cors: "*"`; the `X-Frame-Options`/`Content-Security-Policy` collision in both orders, the `blob:` frame source, the `default-src` fallback for the development socket.io origin, an exact-current-origin `frame-ancestors`, and the File form's framed PDF preview (decisions RJ-3, RJ-4, RJ-5, RJ-7). No existing test module covers the response layer's headers. |
| `blitzy/documentation/PR Description.md` | New | D10.9, D13.c, D14, Rule 1 | The feedback asks for notes "in the PR description" (manual screen-reader checks, the retained `allow_cors: "*"` cases, files outside the twelve) and Rule 1 requires a decision log. No such artefact existed in the repository, so this committed document is it (adjudication record I-1). |
| `cypress/support/commands.js` | Existing | D2, D11, D14 | **Defect.** `cy.login` discarded the `csrf_token` that `POST /api/method/login` now returns, so the helpers that read `window.frappe.csrf_token` sent the login page's Guest value (the literal `"None"`, which `add_csrf_token` interpolates for a token-less session) against the session just created: reproduced on this tree as `400 CSRFTokenError` for a write issued straight after `cy.login`, and as a 20 s `cy.its()` timeout once `cy.session` has cleared the page. Without a fix, D2 continuity is broken for `cypress/integration/dashboard_links.js`, whose `before()` hook logs in and then writes four times before any page load. **Decision.** `cy.login` records the login response's token in a module-level map keyed by the `cy.session` id and marks that key active after both creation and restoration; `call`, `get_list`, `get_doc`, `insert_doc`, `update_doc` and `remove_doc` resolve the active session's token, write it into `window.frappe.csrf_token` when a page with a `frappe` object is loaded, and fall back to the page's own token when nothing was recorded (form logins, and a server that returns no token); `cy.call("logout")` drops the recorded tokens together with the saved sessions. This mirrors `FrappeClient.set_csrf_token` (D11). `cypress/integration/dashboard_links.js` gains the regression case `writes through cy.insert_doc right after logging in, before any page load`. **Alternatives.** (a) One "current token" variable instead of a map — rejected: `cy.session` does not re-run setup for a restored session, so a spec that alternates users (`file_uploader.js`, `permissions.js`) would resolve another session's token. (b) Force a token-injecting `cy.visit` inside `cy.login` or before every unsafe helper — rejected: it adds a page load to every login and discards the page state specs set up before writing. (c) Fetch the token from the server per helper call — rejected: an extra round trip per call for a value the login response already carries. **Risks.** The map lives for the spec run, so a session destroyed outside `cy.call("logout")` — a UI-driven logout, which no shipped spec performs before a helper call — would leave a recorded token that no longer matches its `sid`; such a request is unauthenticated in any case. The key is the credential pair already written literally in the specs and stays in the Cypress process only. |
| `frappe/desk/doctype/dashboard_settings/dashboard_settings.py` | Existing | D4 | `save_chart_config` merges one chart's entry into the user's `chart_config` JSON after reading the whole value; two widgets saving at once both read the old JSON and the later write dropped the earlier chart's entry (measured as a MariaDB 1020 lost update). The read now takes the row under `for_update=True`, held until the request commits, and a missing row still raises `frappe.DoesNotExistError` as `frappe.get_doc` did. The whitelist, the type annotations and the reset/merge logic are unchanged (RB-4). |
| `cypress/integration/dashboard_links.js` | Existing | D2, D11, D14 | Regression case for the `cypress/support/commands.js` change above: its first test clears the saved sessions, logs in over the API and writes through `cy.insert_doc` with no page load in between — the exact sequence the spec's own `before()` hook performs and the one the discarded login token broke. The three pre-existing tests are unchanged. |
| `blitzy/documentation/Project Guide.md` | New, and added by the delivery this refinement reviews — **not changed by this refinement** | none (D1 excludes it) | Listed for completeness because `git diff a8824d994f..HEAD` contains it: the Project Guide was committed by the pre-refinement delivery (commit `932cb6aae4`) and `git diff 932cb6aae4..HEAD -- "blitzy/documentation/Project Guide.md"` is empty. D1 excludes reconciling its pending decision-log rows and its test inventory, so the refinement leaves the file untouched and records its own decisions in §6 of this document instead. |

Per Project Guide Section 5.2 these are framework-wide changes and need maintainer sign-off before
merge; the twelve Section C files were also modified further by D3–D11.

### Section C files touched again by this refinement

Eight of the twelve Section C files are modified again by this refinement (`git diff --name-status
932cb6aae4..HEAD`); the other four were changed by the original delivery only and are untouched here.
They are already covered by the Section 5.2 sign-off the Project Guide records, and are listed so the
reviewer sees which directive reopened each one.

| Path | Directive(s) in this refinement |
| --- | --- |
| `frappe/auth.py` | D11 (CSRF mint at API login, fail-closed rejection for token-less cookie sessions), D13 (`allow_cors: "*"` no longer exempts CSRF) |
| `frappe/public/js/frappe/utils/utils.js` | D3 (`format_chart_axis_number`, exact abbreviations, `set_space_label_ratio` width awareness) |
| `frappe/public/js/frappe/widgets/chart_widget.js` | D3 (axis formatter and density wiring), D4 (time-window control lifecycle), D5 (error state with Retry), D6.a/b (menu keyboard operability and focus restoration), D6.c (focusable plot area, keyboard tooltips, live region), D6.d (applied option marked) |
| `frappe/public/js/frappe/widgets/number_card_widget.js` | D6.a/b (Card Actions toggle as a native button, focus restoration), D8 (tile hover and focus affordance, keyboard activation) |
| `frappe/public/js/frappe/utils/dashboard_utils.js` | D4 (per-widget chart settings, single window accessor), D6.a/b/d (`make_dropdown_keyboard_operable`, `label_dropdown_menu`, `mark_selected_dropdown_option`), D9 (`is_unset_filter_value`, empty dynamic filters omitted) |
| `frappe/public/scss/desk/desktop.scss` | D7 (WCAG AA contrast overrides scoped to the Desk dashboard and widget surfaces), D5 (`.chart-retry:focus-visible` ring, RC-7), D8 (tile hover, `:focus-visible` and `:focus-within` treatment) |
| `frappe/tests/test_auth.py` | D11.d / D10 (CSRF mint, fail-closed and same-site-evidence coverage; the pre-refine fail-open case flipped per O-5) |
| `frappe/tests/test_api.py` | D11.d / D10 (login token exposure, token-accepted and token-less rejection over real HTTP; the pre-refine fail-open case flipped per O-5) |
| `frappe/desk/doctype/dashboard_chart_source/dashboard_chart_source.py` | none — unchanged by this refinement |
| `frappe/desk/doctype/number_card/number_card.py` | none — unchanged by this refinement |
| `frappe/desk/doctype/dashboard_chart_source/test_dashboard_chart_source.py` | none — unchanged by this refinement |
| `frappe/desk/doctype/number_card/test_number_card.py` | none — unchanged by this refinement |

Notes per unit:

- `cypress/integration/todo_analytics_dashboard.js` is one of the eighteen feature files and therefore
  needs no D14 flag, but it is the file every front-end unit extended: D2 requires extending the existing
  spec rather than replacing it, so each unit appended one `it` block for its change (axis formatting,
  time-window lifecycle, error retry, keyboard menus, keyboard tooltips, WCAG contrast, tile affordance,
  empty dynamic filters, security headers). The original `it` block still runs; the one assertion
  invalidated by the new option role was updated minimally (decision RD-6).

- Units A, B, C, D, E and H changed only Section C files (`utils.js`, `chart_widget.js`,
  `dashboard_utils.js`, `number_card_widget.js`, `desktop.scss`) besides the spec and this document.
- Unit F modifies only `frappe/public/scss/desk/desktop.scss` (Section C file 8). The token definitions in
  `frappe/public/css/espresso/{effects,legacy,colors}.css` and
  `frappe/public/scss/desk/{breadcrumb,css_variables,dark,global}.scss` were read but left unmodified —
  see decision rows RF-1, RF-3, RF-4 and RF-6.
- Unit G made no change to `frappe/public/js/frappe/widgets/base_widget.js`: the affordance class is applied
  by `number_card_widget.js` itself (see RG-1), so no framework-wide widget behaviour was altered.
- Unit H proved the consumer widgets (`chart_widget.js`, `number_card_widget.js`) need no change for D9
  (see RH-3).

## 4. Accessibility checks that still require manual verification

The keyboard, focus and ARIA behaviour of this refinement is covered by automated assertions in
`cypress/integration/todo_analytics_dashboard.js`, which exercise opening, navigating, activating and
closing each widget menu, the return of focus to its control, the `aria-checked` state of the applied
option, and the presence and resolution of every menu's accessible name. What those assertions cannot
reach is of two different kinds, and this section keeps them apart because they need different equipment
and produce different evidence:

- **§4.1 — spoken output.** Cypress asserts the DOM and the focus position; it cannot observe what
  assistive technology announces. These checks need a screen reader (NVDA or JAWS on Windows, VoiceOver
  on macOS or iOS) and someone listening to it.
- **§4.2 — painted result.** The contrast assertions compute ratios from live computed styles; a
  computed style cannot prove what a forced-colours palette, a redefined theme token or a real keyboard
  focus paints on screen. These checks need eyes on a rendered screen. No assistive technology is
  involved in any of them, and none of them is an announcement.

§4.3 holds what is neither: two defects observed while verifying that are detectable from the DOM, and
are therefore recorded as defects to fix rather than parked as manual checks.

### 4.1 Screen-reader checks (spoken output)

#### Unit B — time-window controls

- Unit B (D4c): focus restoration after a time-window selection and after a `Refresh`/`Reset Chart`
  rebuild was verified programmatically (`document.activeElement`) and in Cypress (`have.focus`), for both
  mouse and keyboard selection. What a screen reader announces when the chart is redrawn under the
  restored focus is not asserted and needs manual verification with NVDA or VoiceOver.

#### Unit C — error-state recovery

- Announcement of the chart error message and of the Retry control by a screen reader
  (`role="alert"` / `aria-live`) requires manual verification. The markup, the accessibility tree
  (`alert`, `atomic`, `live="assertive"`, `button "Retry loading <chart>"`) and keyboard operability were
  verified in headless Chrome, but no screen reader was driven, so the spoken output is unverified.
- Announcement of the control that receives focus after a **successful** retry. On success the error
  region and its Retry button are hidden and focus is moved on (RC-3), so confirm the reader announces
  the control focus lands on — its name, its role and, for the action menu, its collapsed state — rather
  than going silent or announcing the document. Confirm too that clearing the alert region does not
  produce a stray second announcement of the message that was just resolved. The focus destination itself
  is asserted automatically; what a reader says when it arrives is not.

#### Unit D — widget menus

- **Menu open and close announcements.** With focus on a widget control ("Chart Actions", "Card Actions",
  the timespan, time-interval or heatmap-year control), confirm the screen reader announces the control as
  a collapsed button with a popup, announces the expanded state when the menu opens, and announces the
  collapse when Escape, an outside click or an activation closes it.
- **Menu item count.** Confirm the reader announces the number of options in the open menu ("1 of 5" or
  the equivalent for that reader) and keeps the position announcement correct while ArrowDown, ArrowUp,
  Home and End move through the options, including across the wrap from the last option to the first.
- **Checked state of the applied option.** Moving between the options of the timespan and time-interval
  menus, confirm the reader announces the applied option as checked or selected and the others as not
  checked, and that after choosing a different option the newly applied one is announced as checked —
  both when the choice is made with the keyboard and when it is made with the pointer. The heatmap-year
  menu carries the same state and should be checked the same way.
- **Accessible names of the controls.** Confirm the reader announces "Chart Actions", "Card Actions" and
  "Set Filters" for those three controls, and that the timespan and time-interval controls announce their
  current value, which is their only visible label. Confirm the same name, role and state are announced
  when focus reaches each control by <kbd>Tab</kbd>: that spoken name is the counterpart of the painted
  focus ring, whose visibility is a §4.2 check.
- **Accessible names of the menus.** Confirm each open menu is announced with the name of the control
  that opened it (wired through `aria-labelledby`), so that two menus open on the same dashboard are
  distinguishable by ear.
- **Focus announcement when focus returns to the control.** After Escape, after an outside click, after
  activating an option, and after the chart rebuilds following "Refresh", confirm the reader announces the
  control again — a silent focus move, or an announcement of the page or document instead of the control,
  is a defect even though the automated tests see the focus on the right element.
- **Filter dialog.** Confirm the "Set Filters" control is announced as opening a dialog
  (`aria-haspopup="dialog"`), that the dialog's own name is announced when it opens, and that closing it
  returns the reader's focus to the "Set Filters" control. For a chart on a document type, the same
  control opens a filter popover instead of a modal dialog; confirm that surface is announced and that
  focus returns to the control when it closes. Note the known gap recorded in §6 (RD-2): Escape does not
  dismiss that popover, which is pre-existing Desk behaviour outside this refinement.
- **Reader-specific modes.** Run the checks above in the reader's browse/virtual mode as well as its
  focus/forms mode, because the menus are built from anchors inside a `role="menu"` container and the two
  modes traverse that structure differently.

#### Unit E — plot-area tooltips

- Screen-reader announcement of the plot area's `aria-label` on focus: verify that tabbing to a chart's plot
  area announces it as a labelled group reading "<chart name> chart. Use the arrow keys to read values." in
  NVDA, JAWS and VoiceOver. Cypress can assert that the attribute is present and non-empty, but not what a
  reader speaks or whether the label is truncated by the reader's verbosity settings.
- Announcement of the live-region text on each arrow move (politeness and verbosity): verify that every
  <kbd>→</kbd>, <kbd>←</kbd>, <kbd>Home</kbd> and <kbd>End</kbd> press announces the new data point exactly
  once and in full (title plus every series value), that `aria-live="polite"` does not cut off the label
  announcement made on first focus, and that holding or rapidly repeating an arrow key does not produce a
  backlog of announcements that makes the chart unusable. Politeness handling and announcement coalescing are
  reader- and browser-specific and cannot be asserted in an automated test.
- Whether the tooltip values are read in a sensible order for two-series charts: verify that the trend chart
  announces the day first and then "Created" before "Completed" — the same order as the legend and the visual
  tooltip — and that the single-series Top Owners chart reads "<owner>: Open ToDos <count>" without repeating
  the series name redundantly.
- Announcement after <kbd>Esc</kbd>. Only the announcement is manual. The focus position itself is
  deterministic and is asserted in the spec, not in this list: the plot-area handler contains the key
  (`preventDefault()` and `stopPropagation()`, RE-10), so the Desk's global escape handler — which blurs the
  focused element on untouched Desk controls — never sees it and focus stays on the plot area. The
  "plot-area tooltips are reachable from the keyboard" case in `cypress/integration/todo_analytics_dashboard.js`
  asserts after Escape that the tooltip is hidden, the live region is cleared and `cy.focused()` is still the
  `.chart-plot-area` of the same widget. What does need a human is the assistive-technology part alone:
  whether a reader announces the cleared live region and the retained focus comprehensibly and does not
  leave the reading cursor stranded.

#### Unit F — chart error and no-data states

- **Screen-reader announcement of the error and no-data states.** The two
  `.chart-loading-state` nodes are normally hidden and were force-shown for measurement. Whether
  NVDA, JAWS or VoiceOver announce them when a chart actually fails or returns no data — and
  whether the announcement conveys the error rather than only its colour — was not exercised.
  The colour of both states is a §4.2 check, not this one.

#### Unit G — number card tiles

The checks below are exercised programmatically (attributes, roles, computed styles, key handling) but their
announcement has not been verified with a real screen reader on this host, which has no assistive technology
installed.

- Announcement of each tile on focus: a screen reader should announce the tile as a link with the name the
  card's type and destination give it — "<card title>: open the <doctype> list" for the two delivered cards
  (for example "ToDo Total Open: open the ToDo list, link"), "<card title>: open the <report> report" for a
  Report card, "<card title>: open <route>" for a Custom card (RG-2). Verified in the Chrome accessibility
  tree as `link "ToDo Total Open: open the ToDo list" focusable focused`; NVDA/JAWS/VoiceOver output is
  unverified.
- Announcement of the tile's value: the count rendered inside the tile body is not part of the tile's
  accessible name, so a screen reader reads the name and then the tile's text content. Whether users prefer
  the value inside the name is a judgement call that needs listening tests.
- Order and separation of the tile and its nested "Card Actions" menu button: both are in the tab order, the
  tile first. That the two are announced as distinct controls (a link inside which a menu button lives)
  needs confirmation with a real screen reader.

#### Unit H — empty filter write

None. The change is confined to filter-state computation in `frappe/public/js/frappe/utils/dashboard_utils.js`;
it adds no markup, no ARIA attribute and no focus behaviour, so it has no screen-reader surface.

#### Units I and J — CSRF and security headers

None. Both changes are server-side (request validation and response headers) and add no markup, ARIA
attribute or focus behaviour.

### 4.2 Manual visual checks (no assistive technology involved)

Every item here is a rendering question, so none of them is an announcement and none needs a screen
reader: they need a person looking at a screen, in two cases in a specific display mode.

#### Unit F — contrast

The Cypress assertions added for this unit compute contrast ratios from live computed styles, which covers
the colour requirement on the two shipped themes but not the following:

- **Forced-colours / high-contrast mode.** Windows High Contrast and
  `forced-colors: active` replace author colours with system colours entirely. Whether the
  focus ring and the chart error state remain distinguishable under a forced-colours palette
  cannot be asserted from computed styles and was not exercised at runtime.
- **User-defined and custom Desk themes.** The overrides resolve `var(--ink-gray-6)`,
  `var(--ink-gray-5)` and `var(--ink-red-8)` from whichever theme is active. Only the shipped
  light and dark themes were measured; a site that redefines those tokens, or a browser-level
  custom stylesheet, may land below AA and needs re-measuring per theme.
- **Painted focus ring under real keyboard navigation.** Chrome only matches
  `:focus-visible` for a programmatic focus when the last input modality was the keyboard, and
  a Cypress run cannot set that modality reliably, so the Cypress assertion falls back to the
  resolved `--focus-default` token (RF-8). The ring was verified as painted pixels in the runtime
  screenshots listed in section 7, but tabbing through the widgets with a real keyboard and
  confirming the ring is visible at every stop is a manual check. A focus ring is painted, never
  announced; its spoken counterpart is the §4.1 Unit D check that each control announces its own name,
  role and state when focus reaches it.
- **Non-text contrast of the chart graphics themselves.** Series colours, gridlines, axis
  ticks and the bar value labels are drawn by `frappe-charts` and are outside the tokens this
  unit changed. The dark-theme bar value label in particular renders close to the card
  background and should be reviewed by eye.

#### Unit G — tile hover and focus treatment

No additional manual check. The hover, `:focus-visible` and `:focus-within` treatment of a Number Card
tile is visual only and carries no announcement, which is why it has no §4.1 counterpart; its colours are
covered by the D7 contrast work above and its painted states by the runtime pixel diffs and screenshots
in §7 under "Unit G — tile hover affordance".

### 4.3 Defects observed while verifying (detectable from the DOM, tracked rather than manual)

Neither item below is a manual check. Both are observable from the DOM or the computed layout, so both can
be asserted automatically, and both are recorded here as open defects rather than as work for a
screen-reader session. Both were observed while verifying D4c, and both live in the dropdown and control
markup the time-window controls render:

- **The `Select Date Range` input has no accessible name.** The input rendered into
  `.dashboard-date-field` carries no `id`, no `name` and no associated `<label>`, so its accessible name
  resolves to empty and a reader falls back to the placeholder or to nothing. Detectable without
  assistive technology, from the rendered control's attributes and computed accessible name.
- **A half-width widget hides its own title while the date-range input is displayed.**
  `render_date_range_field()` hides the widget title and subtitle when the widget is not full width and
  is narrower than 700 px, and the timespan control restores them when the selection leaves
  `Select Date Range` (RB-9), so such a widget is unnamed on screen for as long as a date range is
  selected. Detectable from the computed style of the title node.

Neither is fixed by this refinement: both sit in the dropdown and control markup left to the units that
own it, and neither is a regression introduced here.

## 5. CORS `allow_cors: "*"` audit

### Unit I — audit, tightening and retained cases

Directive D13 asked for an audit of sites configured with `allow_cors: "*"`, for the CORS posture to be
tightened so those sites are not exempted from the CSRF and header protections, and for any retained
`"*"` to be documented with its reason.

**Configuration surface.** No site sets `allow_cors` at all. Searched: every `*.py`, `*.json`, `*.js`
and `*.md` file in the repository (`grep -rn "allow_cors"`, excluding `node_modules`), and every bench
site configuration on the verification host —
`/opt/frappe-bench-{0,4,5,8,setup}/sites/*/site_config.json` and
`/opt/frappe-bench-{0,4,5,8,setup}/sites/common_site_config.json`. That grep matches nine files, and no
site configuration among them: three implementation files (`frappe/app.py`, `frappe/auth.py`,
`frappe/integrations/oauth2.py`), four test modules that set `frappe.conf.allow_cors` themselves
(`frappe/tests/test_cors.py`, `frappe/tests/test_auth.py`, `frappe/tests/test_api.py`,
`frappe/tests/test_security_headers.py`) and two Markdown files that only discuss the key in prose
(`blitzy/documentation/PR Description.md` — this document — and `blitzy/documentation/Project Guide.md`).
The only implementation and configuration occurrences are therefore the code paths below; the two
documentation matches carry no behaviour. The audit accordingly covers the configuration surface (the
`allow_cors` site-config key) and every code path that sets or consults `"*"`.

| Where `"*"` appears | Kind (site config / code path) | Disposition | Reason |
| --- | --- | --- | --- |
| `allow_cors` key in `site_config.json` / `common_site_config.json` | site config | none found | No site in the repository or on the verification host sets the key; the paths searched are listed above. A site that does set `"*"` is now subject to the CSRF check like any other site. |
| `frappe/auth.py` `is_allowed_cors_origin` | code path (CSRF exemption) | **changed — exemption removed** | `allow_cors == "*"` used to make any cross-origin unsafe request on a token-less cookie session pass. A wildcard names no origin, so it cannot express trust in the origin that made the request. It now returns `False`; an explicitly configured origin still returns `True` (see RI-3). |
| `frappe/app.py` `set_cors_headers` | code path (response headers) | unchanged | Reflecting the request `Origin` with `Access-Control-Allow-Credentials: true` for `"*"` is the documented CORS behaviour of the framework and is what `frappe/tests/test_cors.py` asserts; the CSRF tightening above does not need it changed, and `frappe/app.py` belongs to the security-response-header work. `test_cors.py`'s four tests, including its `allow_cors = "*"` case, pass unchanged. The alternatives weighed and the residual risk are in RI-9. |
| `frappe/integrations/oauth2.py` `get_authorization_server_metadata` (sets `frappe.local.allow_cors = "*"`) | code path | **retained** | The RFC 8414 authorization-server metadata document is public by specification and is served on `GET`. It sets `frappe.local.allow_cors`, which only `set_cors_headers` reads — the CSRF path reads `frappe.conf.allow_cors` alone — so it never exempted a request from CSRF and does not now (RI-10). |
| `frappe/integrations/oauth2.py` `set_cors_for_privileged_requests` for `/.well-known/` (`GET`, `OPTIONS`) | code path | **retained** | Same discovery metadata, safe methods only, and again `frappe.local`. Removing it would break preflight for public OAuth clients without adding any protection (RI-10). |
| `frappe/integrations/oauth2.py` `_set_allowed_cors` (OAuth Settings `allowed_public_client_origins`, where an operator may enter `*`) | code path | **retained as an operator choice** | Dynamic client registration and the token, revocation, introspection and userinfo endpoints authenticate with client credentials or a bearer token, not with the session cookie, so they are outside the CSRF check either way, and the value is set on `frappe.local`. Risk, documented rather than removed: an operator who enters `*` here allows any origin to make credentialed cross-origin calls to those endpoints; the narrower configuration is to list the public clients' origins explicitly (RI-11). |
| `frappe/integrations/oauth2.py` `set_cors_for_privileged_requests` early return when `frappe.conf.allow_cors == "*"` | code path | unchanged | It only avoids narrowing an already site-wide CORS configuration; it grants nothing further (RI-10). |

**Operator guidance.** Configure `allow_cors` with the explicit list of origins the site trusts rather
than `"*"`. A site that keeps `"*"` still gets CORS response headers as before, but its cookie sessions
are now subject to the CSRF check: cross-origin unsafe requests must supply the session's CSRF token.
`"*"` is not a way to opt out of CSRF, and it is not a way to opt out of the security response headers
added by the response-layer work.

### Unit J — regression guarantee for the header baseline

A site with `allow_cors: "*"` receives the CORS headers **and** all four security headers on the same
response — the baseline has no CORS exemption (test
`frappe.tests.test_security_headers.TestSecurityHeaders.test_headers_present_on_cors_response_with_wildcard_origin`).

## 6. Decision Log (Rule 1 — Explainability)

| ID | Decision | Alternatives considered | Why this choice | Risks |
| --- | --- | --- | --- | --- |
| RA-1 | Abbreviation threshold for chart axis ticks is 1000 (the smallest divisor of every number system), and a tick at or above it is abbreviated only when the abbreviation carries it exactly — at most one decimal below 10^6 and at most two from 10^6 up. Anything else is printed in full with the site group separator, so `2000` renders `2 K`, `1500000` renders `1.5 M`, `1250000` renders `1.25 M` and `1250` renders `1,250`. | (a) Keep `shorten_number(label, country, 3)`, which abbreviates from four digits and falls back to `toFixed(2)` below that. (b) Abbreviate everything from 1000 with two decimals, so `1250` would render `1.25 K`. (c) Raise the threshold to 10000, so `2000` would render `2,000`. (d) Abbreviate from 10^6 only. | The refinement asks for thousands separators and forbids the `100.00` shape the old fallback produced; the requested tick set is `0`, `250`, `1,250`, `0.3`, `1.5 M`, which (b) and (c) each contradict on one value. Exactness is the only rule that satisfies all of them at once, and it never displays a rounded number as if it were precise. | An axis whose ticks mix exact and inexact multiples shows both forms, for example `1 K` beside `1,250`. A tick above 10^6 that is not an exact multiple prints every digit (`1,234,567`), which is wide for a y axis; frappe-charts picks round intervals, so such a tick is rare. |
| RA-2 | Tick text comes from the tick's own value. It is first re-rounded with `parseFloat(value.toPrecision(15))`, which drops binary representation noise without a magnitude floor, and then written with `format_number` using the larger of two decimal counts, capped at the tick's own decimals: two decimals, or the decimals that carry three significant digits. A tick whose magnitude is below `1e-4` is written in scientific notation instead, its coefficient carrying at most two decimals. On a site whose number format carries no decimal separator (`#,###`, `#.###`) the decimal-carrying variant of that format is used for a tick that has decimals, and the site separators are applied to the scientific coefficient too, so `#.###,##` renders `12.345,68` and `2,5e-7`. | (a) A fixed two decimals for every tick, which is the rule under review: the frappe-charts interval set `[0, 0.0025, 0.005, 0.0075, 0.01]` comes out as `0`, `0.00`, `0.01`, `0.01`, `0.01` — three distinct texts for five ticks, with `0.005`, `0.0075` and `0.01` all printing `0.01`, measured on the reviewed implementation. (b) A fixed zero decimals, rounding every fractional tick to an integer. (c) The site `float_precision` default of three decimals for every tick. (d) `Intl.NumberFormat` with `maximumSignificantDigits` instead of the framework helper. (e) Scientific notation for every tick below 1. | Distinct tick values must produce distinct tick texts, and a two-decimal cap cannot: frappe-charts derives its intervals from the data, so a sub-cent series yields sub-cent intervals that (a), (b) and (c) all collapse, while the old `toFixed(6)` re-rounding additionally floored every value under `5e-7` to `0`. Three significant digits is the smallest allowance that separates the interval sets the library generates, and it changes nothing at the magnitudes the dashboard shows, where a tick's own decimals or the two-decimal cap still decide (`12,345.678` stays `12,345.68`, `0.3` stays `0.3`). The `1e-4` switch to scientific notation keeps a tick text short instead of printing `0.0000005`. `format_number` keeps the separators the rest of the Desk uses, which (d) would replace with the browser locale, and (e) would write `0.5` as `5e-1`. | A fractional tick can now carry three or more decimals (`0.015`, `0.0025`, `0.000123`), which is wider than the two-decimal shape a literal reading of the refinement asks for and is the deliberate deviation recorded here; the two-decimal cap holds for every tick of magnitude 1 or more, while any smaller magnitude carries as many decimals as three significant digits need, so `0.015` prints `0.015` and `1 / 3` prints `0.333`. Two ticks either side of the `1e-4` boundary are written in different notations, so an axis can show `0.0001` beside `5e-5`. A tick below `1e-4` carries at most three significant digits, so two such ticks that differ only in a fourth digit print the same text. |
| RA-3 | X label density is width-aware and modelled on what frappe-charts 2.0.0-rc27 actually renders. From the measured wrapper width minus the 80 px the library reserves around its plot area, an estimated 5.6 px per character and an 8 px gap between labels, `get_axis_label_space_ratio` returns the ratio whose allowance holds the full labels when they fit; otherwise, for a series axis, it searches label strides from the narrowest that separates two longest labels upwards and takes the first whose rendered index set — the indices on the stride up to `count - stride / 2`, plus the last index when it is off the stride, which is the library's rule including its blanking of on-stride indices in the final `stride / 2` — ends on the last label and keeps every consecutive rendered pair at least that narrowest stride apart; and for a non-series axis it widens the truncation allowance from what fits upwards until the truncated labels are as many distinct texts as the labels themselves. `get_axis_label_options` pairs that ratio with `xIsSeries: 1`, so every Line and Bar axis is thinned into complete labels rather than truncated, and `set_space_label_ratio` applies the pair; both leave an explicitly supplied ratio alone. The chart widget asks for the flag for every Line and Bar chart, including one whose width cannot be measured yet and therefore carries no ratio, so a chart first drawn while hidden is thinned rather than truncated when a later resize applies a ratio to it. | (a) Keep `labels.length > 10 → 0.9`, measured as the cause of the 31-label overlap at 1024 px. (b) A lower fixed constant such as 0.6 for every chart, which thins labels that would have fitted. (c) Rotate or stagger the labels, which frappe-charts does not support through `axisOptions`. (d) Truncate `data.labels` in the widget before handing them to the chart. (e) Accept the library's truncation on a non-series axis and only widen the allowance. (f) Switch `xIsSeries` per width rather than per chart, setting it only when the labels do not fit. | The library thins or truncates against its own allowance, so a ratio is only correct if it is derived from the same rule: the pre-refine stride search accepted a stride dividing `count - 1`, which is exactly the case rc27 blanks, and 31 daily labels at a 620 px plot rendered `0, 5, 10, 15, 20, 25` with the newest date blank, where the modelled stride renders `0, 7, 14, 21, 30`. Truncation cannot be made legible by any ratio when labels share a prefix — five owner names at a 255 px plot rendered `Ali ...` three times — so (e) leaves the reported defect in place and only thinning, which renders each surviving label complete, resolves it; `state.xAxis.labels` keeps the full labels, so tooltips and the CSV export are unaffected, which (d) would change. (f) would desynchronise the model on a resize, because the resize path re-applies the ratio alone. | `xIsSeries` now states how an axis is thinned rather than whether its x values are a series; in rc27 it feeds nothing else, but a future version could give it more meaning. A narrow axis shows fewer labels — two of five owner names at a 375 px viewport — and the rest are read from the tooltip. The 5.6 px per character is an estimated average for the 10 px Desk axis font, so a label of unusually wide glyphs can still crowd its neighbour. A caller that passes `is_series = false` and applies the returned ratio without `xIsSeries` gets truncated labels that are distinct but crowded, since the allowance is widened past what fits rather than duplicated. |
| RA-4 | One resolver (`get_effective_axis_label_ratio`) answers the density question everywhere: the ratio configured through custom options when there is one — the chart record's winning over the widget instance's, the precedence `get_chart_args()` already applies — else the ratio measured for the current labels at the current width. It is written to `chart.config.seriesLabelSpaceRatio`, the property frappe-charts re-reads on every redraw, from three places: immediately before the single `update(this.data)` on the data path, from a debounced (200 ms) `window` resize listener, and from a `ResizeObserver` on the chart wrapper that feeds the same debounced handler. A ratio that resolves to nothing is written as `undefined`, the library's unset value. Both watchers are bound once per rendered wrapper, re-bound when the wrapper is replaced, and released by `release_chart_watchers()` on `refresh()`, on `delete()` and on a resize that finds the widget gone from the document. | (a) Rely on the frappe-charts `ResizeObserver` alone, which redraws with the ratio captured at construction. (b) Re-create the chart on every resize. (c) Recompute on the widget's own refresh only, leaving both a resized window and a re-flowed container stale for the session. (d) Watch `window.resize` alone, which leaves a container-only width change — the Desk sidebar collapsing, a widget group re-flowing — stale. (e) Recompute the ratio on the data path but leave it in the chart arguments, as a redraw through `update()` ignores them. (f) Carry a "the ratio is caller-supplied" flag on the widget instead of resolving the configured ratio at each use. | A ratio is only correct for the width and the label set it was computed at, so a chart built wide and then narrowed, and a chart redrawn with 31 labels where it was built with 8, were both drawn with a ratio measured for something else — (e) is why: frappe-charts takes the ratio from `chart.config`, not from the arguments handed to `update()`. Resolving it in one function is what keeps the data path and both resize signals in agreement and keeps an explicitly configured ratio surviving a resize exactly as it survives the initial render, which (f) would only approximate. Updating the existing chart keeps the library's own redraw path and its animations; (b) discards the chart state on every drag frame. | The write targets a frappe-charts `config` property, so a future version of the library could rename it; the write is guarded and a missing property degrades to the previous behaviour. A resize storm schedules one update per 200 ms per chart widget. A chart whose width cannot be measured — a hidden widget — falls back to the library's own 0.6 default until its wrapper resizes. Where `ResizeObserver` is unavailable the window listener is the only signal, which is the previous behaviour. |
| RA-5 | Values printed over points are routed through the same axis formatter. After the chart is drawn, the widget rewrites each `text.data-point-value` from the dataset value behind it, and a `MutationObserver` on the chart wrapper repeats that pass whenever frappe-charts re-renders the labels. Each value is first normalised to a finite number, so a dataset value that arrives as a numeric string (`"1250"`, which frappe-charts plots unchanged) is formatted too, while a value that holds no number — blank, boolean, object, `null`, `NaN`, `Infinity` — keeps the text the library rendered instead of being blanked. Stacked bars are included: the top bar layer, the one frappe-charts labels with the running total, is written from the total the widget derives from every dataset at that point, and each lower layer from its own values. | (a) Leave the library's own `K`/`M` shortener in place, which prints `1250` as `1.3K` and a fractional value with its full binary noise. (b) Pre-format the dataset values, which the chart needs as numbers for its geometry. (c) Re-run the pass on a timer matched to the animation duration. (d) Patch or fork frappe-charts. (e) Rewrite only values that are already JavaScript numbers. (f) Leave stacked charts on the library's formatting. (g) Read the library's own `cumulativeYs` for the top layer instead of deriving the totals. | The refinement asks for consistent numeric labels, and the values over the Top Owners bars are numeric labels rendered by a different code path from the axis; frappe-charts exposes no formatter hook for them. Observing the wrapper is what survives the entry animation and the end-of-animation re-render without guessing their timing, and the rewrite is idempotent. (e) and (f) each left part of the chart inconsistent with its own axis: (e) printed the library's `1.3K` over a point whose numeric-string value the axis showed as `1,250`, and (f) left a stacked bar disagreeing with its axis in two ways at once, since frappe-charts abbreviates a lower layer's own value to `1.3K` but prints the top layer's running total ungrouped as `1550`. (g) is built by frappe-charts as `c + values[i]`, which concatenates numeric strings instead of adding them, so the widget sums the normalised values itself; a derived total is formatted only where at least one dataset holds a number, which is what keeps a label from being blanked. | The pass depends on the library's `dataset-units` / `data-point-index` markup and, for a stacked chart, on the top bar layer being the layer that carries the running total; if either changes the labels silently keep the library format, and a stacked chart whose layer order or cumulative layer moved would print a total over the wrong bar. One extra observer callback runs per rewrite batch. |
| RB-1 | Keep `frappe-charts`' own `update(data)` as the redraw path for axis charts and re-create the chart object only for circular charts or when `update()` throws. | (a) Always delete and re-create the chart object on every selection; (b) re-create whenever the label count changes. | Runtime measurement showed `update()` does follow the new x-axis label count (8 → 32 → 6 → 14 → 8 → 10 observed), so re-creating on every selection would discard the library's transition for no behavioural gain; a `try`/`catch` around `update()` with a full re-creation fallback keeps the redraw guaranteed even if the library throws on a shape it cannot animate. | Depends on `update()` remaining able to grow and shrink the axis; the fallback covers a regression in it at the cost of losing the animation for that redraw. |
| RB-2 | Tag every fetch with a monotonic per-widget sequence number, hand that tag to `fetch()` itself, and ignore every response that is not the latest — a result and a failure alike: the success handler and the `xcall` error callback both compare the tag against `this.fetch_sequence` before they touch the widget. Each request captures its own response body in a request-local variable read only by its own error callback, rather than in a field shared by every request. `refresh()` and `delete()` bump the sequence, so a request already in flight can neither render nor raise an error state afterwards, and a second generation counter does the same for a render still waiting on a doctype meta load: when `frappe.model.with_doctype` resumes it, it draws nothing and binds no watcher. No debounce and no request cancellation. | (a) Debounce selections by a few hundred milliseconds; (b) abort the in-flight request; (c) disable the controls while a fetch is in flight; (d) tag the success path only and let every failure through, which is what the first implementation of this row did; (e) keep the captured response on the widget (`last_fetch_response`) and let whichever error arrives read it. | The directive asks that a fast second selection never be overwritten by the first response, which is a response-ordering problem, not an input-rate problem; a sequence check fixes it without delaying any selection, without touching `frappe.xcall`'s transport and without making the controls unresponsive. An error is as much a response as a result, so (d) left the defect intact in the shape that matters most: an older request failing after a newer one had drawn replaced a live chart with an error state. And because two requests overlap, the body captured through the `always` hook has to belong to the request whose error reads it, which (e) cannot guarantee — the second request's body overwrites the first's before the first fails. | A superseded request still runs to completion on the server; its result is discarded on arrival. A superseded failure is now silent: the user learns of a failure only from the latest request, so a window that fails for every request shows the error of the last one rather than the first. `fetch()`'s sequence parameter is optional and a caller that omits it is tagged with the current sequence, which is the previous behaviour. |
| RB-3 | Copy the Dashboard Chart document into each widget (at both places the widget takes it — `get_settings()` and `update_chart_object()`) rather than removing the mutations in `render()` and `prepare_chart_object()`. | (a) Stop mutating `chart_doc` at all; (b) mutate a separate object only for the fields that are written; (c) fix the callers that hand the shared object in. | `frappe.model.with_doc` returns the shared `locals[doctype][name]` object, so every widget on the page and the client model cache saw the same document; copying it once at the point the widget takes ownership makes the whole widget safe, including code paths added later, whereas auditing individual mutations leaves the next one to reintroduce the leak. | A deep copy by JSON round-trip drops any function or `undefined` value the document might carry; Dashboard Chart documents are plain data, so nothing is lost today. |
| RB-4 | One accessor (`get_time_window()`) resolves the effective window for every consumer — the toggle label, the option marked as applied, the request arguments and the saved entry — as live selection → this user's saved setting → the chart record's own value, and every selection persists the effective `timespan` **and** `time_interval` pair. `from_date`/`to_date` are part of that window only while the resolved timespan is `Select Date Range`, whichever level holds them; the date-range control adopts the window it renders into the widget's live selection and persists that window when its dates change; each widget sends its setting writes one at a time and the server applies them under a row lock on this user's Dashboard Settings row; and removing the date-range control restores the title, subtitle and header direction it was given room by. Two identically configured timeseries charts on a throwaway dashboard are what proves per-widget isolation. | (a) Persist only the field that changed and read each field at its use site (the pre-refine shape); (b) read the label and the applied option from `chart_settings` while the date field is decided by the accessor; (c) add the chart record's dates to the chain without gating them on the timespan; (d) hard-code `Select Date Range` in the date-range control's write instead of reading the accessor; (e) order the writes on the client only, or lock on the server only; (f) restore the header in each caller of the teardown, as the timespan option did; (g) prove isolation against the shipped non-timeseries `ToDo Top Owners` chart. | The pre-refine code persisted only the changed field and read the rest from different places, so a timespan selection sent `time_interval: null` while the label read `Daily`, an unsaved `Select Date Range` pick rebuilt with the previous timespan on the toggle and marked as applied, and editing a saved range after a reload persisted `timespan: null` — which then resolved to the chart record's preset and sent a preset window together with dates. One accessor makes all four consumers agree by construction, and (b) and (d) each leave one of them reading a different source. The gate is the server contract: `dashboard_chart.get` reads `from_date`/`to_date` only for `Select Date Range` and otherwise passes the argument into `from_date.strftime`, so (c) would turn a `chart_config` entry written by the unfixed build into an HTTP 500 on every standard chart. Ordering a widget's writes fixes two selections overtaking each other, and the row lock fixes two widgets' whole-JSON read-modify-writes dropping each other's entry (measured: unlocked, one entry is lost and the late writer fails with MariaDB 1020) — each covers a case the other cannot, so (e) is half the fix. The teardown owns the restoration because four callers reach it (`refresh`, `delete`, `reset_chart`, `render_time_series_filters`) and only one of them restored the header. (g) cannot fail: a chart with no time-window state has no window to leak. | One saved entry now always carries both fields, so a site that edited `chart_config` by hand sees both values replaced on the next selection, and dates stored there against a preset timespan are ignored instead of sent. A widget's settings request waits for its own previous one; a failed write is surfaced by the request layer and not retried. The row lock serialises one user's concurrent setting writes for the duration of one update. The header is restored only where this widget collapsed it, so a header hidden by anything else is left alone. |
| RB-5 | A repeated identical selection still fetches and redraws; no de-duplication of "the value did not change". | (a) Skip the fetch when the selected value equals the current one; (b) skip only the redraw. | The directive requires the dropdowns to "correctly re-render the chart on every selection change", and a user re-picking the shown value is the manual way to refresh a stale window; skipping it is what made the control feel dead. | One extra server call when a user re-picks the same value, which is the same cost as the existing `Refresh` action. |
| RB-6 | Remember the control that holds focus by CSS selector before the action area is rebuilt, and re-match that selector in the rebuilt action area. | (a) Keep a reference to the focused element; (b) always return focus to the chart menu (the pre-refine fallback); (c) re-focus nothing. | `make_chart()` empties the action area, so the focused element itself no longer exists after the rebuild and a stored reference is useless; a selector survives the rebuild and lands on the equivalent control, while the chart-menu-only fallback moved focus away from the control the user was operating. | If a future action area stops rendering a control, its selector no longer matches and focus falls back to the chart menu. |
| RB-7 | The new Cypress case resets this user's saved chart window at its start, and waits for `frappe-charts`' SMIL animation nodes to disappear before snapshotting the sibling chart's markup. | (a) Rely on the spec running first on a clean site; (b) compare the sibling chart by label count only. | Per-user `chart_config` survives between runs and between Cypress retries, so an inherited window made the label-count assertions fail on the second attempt; and an `outerHTML` comparison taken during the entry animation compares markup containing `<animate>` nodes against settled markup. Both make the assertion about the fix, not about timing. | The case writes Dashboard Settings for the logged-in user; it restores the entry through `Reset Chart` at the end. |
| RB-8 | Copy the `chart_settings` option inside the widget constructor rather than at the pages that pass it. | (a) Copy in `dashboard_view.js` and the two other call sites; (b) document that callers must pass a copy. | Three pages (`core/page/dashboard_view`, `views/dashboard`, `views/workspace`) hand `chart_config[chart.chart]` straight through, and any future caller would repeat the omission; copying where the widget takes ownership is the single root cause and keeps the pages unchanged. | The widget no longer writes the page's settings object in place, so a caller that expected to read a widget's live selection from its own object must read it from the widget. |
| RB-9 | Tear the date-range control down rather than reuse it: `clear_date_range_field()` calls the datepicker's own `destroy()`, drops the `date_range_field` reference and `.remove()`s the `.dashboard-date-field` wrapper, and the control is built again from scratch by `render_date_range_field()` when it is next needed. It runs on `Refresh`, on `Reset Chart`, on widget `delete`, on every time-series filter re-render, when a timespan selection leaves `Select Date Range`, and re-entrantly before a rebuild. One reuse path is kept: `render_date_range_field()` finds the wrapper already present and visible and only re-focuses its input. | (a) Hide the wrapper and reuse the control and its datepicker, which is the pre-refine behaviour; (b) keep the control and reset only its value through `set_input()`; (c) keep the control but destroy only the datepicker; (d) rebuild the whole action area, date field included, on every selection. | Hiding leaked: each re-entry into `Select Date Range` left the previous `frappe.ui.form.make_control` instance and its datepicker in the DOM with their listeners bound, so repeated use accumulated orphaned controls and the calendar that opened belonged to the earliest of them. `make_control` has no re-initialisation entry point, so (b) and (c) would leave the control half-owned by the widget — and a retained control keeps whatever was last typed into it, while a rebuilt one always shows the window `get_time_window()` reports, which is what makes `Reset Chart` observable. Destroying through the plugin's own `destroy()` before dropping the reference is its documented teardown. (d) would discard the other controls and their focus on a change that concerns one of them. | The control is recreated rather than reused, so transient state — a partially typed range, an open calendar — is discarded and focus has to be re-established explicitly through the `focus_input` argument. Each rebuild costs one control construction. The teardown is also what restores the widget title and subtitle that `render_date_range_field()` hides on a narrow half-width widget, so a future caller that removes the wrapper without going through this method would leave the title hidden (§4.3). |
| RC-1 | The error message is a `div.chart-error-message` with `role="alert"`, created together with the (still hidden) error container so the live region exists in the DOM before any text is written into it. The container is filled exactly once per container: `setup_error_state_content()` returns early when the message node is already its child, so every later error only rewrites the message text. | `aria-live="polite"` on the container; both `role="alert"` and `aria-live="polite"`; building the node only at failure time; leaving the message as bare text in the container as before; rebuilding the message and Retry nodes on every failure. | `role="alert"` is the standard assertive pattern for an error that replaces content, and screen readers announce text inserted into an existing alert region more reliably than a region inserted together with its text. Setting `aria-live="polite"` alongside `role="alert"` would contradict the role's implicit `assertive`. The fill runs once because the Retry control carries `click` and `keydown` handlers: rebuilding on every failure would either duplicate the visible control or, with `append` alone, stack one more handler pair per failure and fire one retry per past error from a single activation. | An assertive region interrupts the current announcement. The announcement itself is unverified without a screen reader (see §4). Anything that needs to replace the Retry control has to empty the error container first; `setup_container()` does exactly that when the widget rebuilds. |
| RC-2 | When the error appears, focus moves to the Retry button only if focus was already inside this widget (or the error follows a retry that this widget's own control started); otherwise focus is left alone. | Always focus Retry when an error appears; never move focus. | A dashboard can fail several charts at once, and each one grabbing focus would steal it from whatever the user is doing; a user who was operating this widget, on the other hand, would otherwise be dropped on `body`. | A keyboard user whose focus is elsewhere gets no focus move and relies on the live-region announcement to learn about the failure. |
| RC-3 | After a successful retry, focus moves to the first element of the same widget that is still in the document and visible, taking the first match of: the action-menu toggle (`button.chart-menu`, labelled "Chart Actions"), the plot area (`this.chart_wrapper`), the "No Data" container, then the widget root — the last three given `tabindex="-1"` when they carry no tabindex of their own. The move happens only when the retry left focus dropped: on `body`, on the document element, on nothing, or on an element of this widget that is no longer in the document or no longer visible (which is where hiding the focused Retry control leaves it). | Focusing `button.chart-menu` alone (the implementation under review); focusing the plot area alone; moving focus unconditionally on every successful retry; leaving focus on `body`. | Focusing the menu alone has no target in two reachable states: customize mode renders no action area at all (`make_chart()` skips `prepare_chart_actions()`), and a widget can recover into its "No Data" state; a widget whose action row was discarded also leaves a detached `.chart-menu` behind, which is why the candidate must be tested for `isConnected` and visibility rather than for existence. A chain that ends at the widget root means every recovery has a target, and it prefers the recovered content over a control once the menu is absent. Restoring only from a dropped-focus state is the RC-2 principle applied to success: a user who moved to another widget while the retry was in flight keeps the focus they chose. | Focus lands on a control rather than on the recovered content whenever the action menu is present. The three fallback targets are containers, not controls: a screen reader announces the container instead of a named control, and their `tabindex="-1"` makes them programmatically focusable without adding a tab stop (the plot area separately carries `tabindex="0"` from RE-2 once it is keyboard-navigable). The dropped-focus condition depends on the browser moving focus off an element hidden with `display: none`; when a browser keeps focus on the hidden Retry control instead, the "not visible inside this widget" branch covers it. |
| RC-4 | Retry re-fetches through `fetch_and_update_chart()` — the same path the timespan and interval controls use, which sends `refresh: 1` and then renders. | Routing retry through the "Refresh" menu action (`delete this.dashboard_chart; this.make_chart()`); calling `fetch()` alone. | `fetch_and_update_chart()` re-requests and renders without rebuilding the widget, so the user's control row, filters and selections survive the retry; `refresh: 1` bypasses the server-side chart cache, so the retry is a real re-fetch instead of a replay of the cached failure. `fetch()` alone would not render the result. | The retry is coupled to `fetch_and_update_chart()`'s argument assembly. A deterministic server failure simply shows the error again (the path is idempotent). |
| RC-5 | The message is derived from, in order: the argument handed to the error callback, that request's response body captured through the `xcall` `always` hook, then `_server_messages` → `message` → `exc_type` → HTTP status → `__("Could not load chart data")`. HTML in server messages is stripped. | Keeping only the original `_server_messages` parsing; always showing a generic message; changing the request layer's error-callback contract in `frappe/public/js/frappe/request.js`. | The request layer passes the error callback nothing at all for 401/403/404/413/500/502/504/508, the parsed body for 417/501 and a `jqXHR` for unhandled statuses, so a single source cannot cover every failure; the `always` hook receives the parsed body for every outcome and jQuery fires it before the `fail` handlers. Widening the widget's handler keeps the change inside the widget instead of altering a contract every caller in the Desk shares. | Relies on jQuery firing `always` before `fail` (verified at runtime on 403 and 500). Stripping HTML loses markup-only detail. The `fetch()` promise still never settles on failure, because the widget's `error` option replaces `frappe.xcall`'s `reject`; recovery runs through the Retry control rather than the promise. |
| RC-6 | The control is a real `<button type="button">`, and Enter/Space are additionally handled in a `keydown` handler that calls `preventDefault()` before retrying. | Relying only on the browser's native button activation; using an anchor or `div` with `role="button"`. | A native button is keyboard-operable and announced correctly; the explicit handler makes the keyboard path assertable from Cypress, whose `trigger("keydown")` does not perform a browser default action. `preventDefault()` stops the native activation from firing a second retry after ours. | Two activation paths on one control; without the `preventDefault()` they would both fire. |
| RC-7 | `.chart-retry:focus-visible` re-applies the framework focus ring (`box-shadow: var(--focus-default)`) inside the `.dashboard-widget-box .chart-loading-state` block. | Leaving the button without a focus indicator; removing the widget-wide `.btn-xs { box-shadow: none }` rule; hard-coding an outline colour. | `.widget.dashboard-widget-box .btn-xs { box-shadow: none }` suppresses the ring the framework already ships for `.btn:focus-visible`, so the new keyboard control had no visible focus (verified: focused and unfocused renderings were pixel-identical). Scoping the re-application to `.chart-retry` restores the indicator without changing any other control, and consuming `--focus-default` means the contrast work on that token applies automatically. | Only the Retry button is fixed; the widget's other small controls (filter, chart menu, timespan and interval dropdowns) still draw no focus ring — that surface belongs to the keyboard/ARIA and contrast directives. |
| RC-8 | The Cypress case forces the chart failure with a `cy.intercept` that replies once with `statusCode: 500` and a body carrying `exc_type: "ValidationError"` and a `_server_messages` string, behind a one-shot latch so the retry that follows reaches the real server and succeeds. HTTP 508 — the status the reported defect was seen under — is not reproduced. This is a deviation from a literal reading of the reported defect, authorised by interpretation I-13. | (a) Reproduce a real 508 by driving the chart-data caching that produced it; (b) intercept with `statusCode: 508` instead of 500; (c) cover the handler at unit level only, by calling the widget's error callback with no argument; (d) drop the automated case and rely on the runtime observation. | What the pre-refine handler got wrong was reading `err._server_messages` when the request layer calls it with no argument at all, and 401, 403, 404, 413, 500, 502, 504 and 508 share exactly that contract (RC-5) — so any one of them exercises the path the directive asks to recover from. A real 508 comes from a server-side loop-detection condition that a browser test cannot provoke deterministically without touching the caching code D1 places out of scope, which rules out (a). (b) would assert a status string the request layer treats identically to 500 while still not reproducing the condition that raises it. (c) would leave the rendered error, the Retry control and the recovery unproven. The one-shot latch matters: the retry is a real request, so the case proves recovery rather than a second stub. | No 508-specific request-layer behaviour is proven by the automated case; if a future framework version handles 508 differently from 500 the spec will not notice. The evidence for 508 itself is the manual runtime observation in §7 under "Unit K — merged-tree regression", not a test. The case also depends on the intercept pattern continuing to match the trend chart source's method path. |
| RD-1 | The Number Card "Card Actions" toggle in `number_card_widget.set_card_actions` becomes `<button type="button" class="btn btn-xs card-menu" data-toggle="dropdown" tabindex="0">`, keeping the `.card-actions [data-toggle="dropdown"]` selector, the `aria-label` and the explicit `tabindex="0"`. | (a) Keep `<a role="button" tabindex="0">` and keep activating it from script on Enter and Space; (b) give the anchor an `href="#"` so the browser activates it; (c) keep the anchor and add `btn btn-secondary` styling. | A native button is activated by Enter and Space by the browser itself, is reachable by Tab without an explicit `tabindex`, and is exposed as a button by every screen reader, which removes the scripted key shim the anchor needed. (b) would add a history entry and a URL change; (c) would not fix activation. `btn btn-xs` alone keeps the transparent background of `.btn`, so the tile looks exactly as before; `btn-secondary` would have added a filled control to every card. | A stylesheet or test selecting `.card-actions a` for the toggle would need `.card-actions button`; the repository contains no such selector, and the class, the `data-toggle` selector, the accessible name and the tab stop are all preserved. |
| RD-2 | The chart "Set Filters" button declares `aria-haspopup="dialog"`, and focus is returned to it from `hidden.bs.modal` on the filter dialog's wrapper (Custom and Report charts) and from `hidden.bs.popover` on the button (document-type charts). | (a) Leave `aria-haspopup="true"`, which means a menu; (b) use `aria-haspopup="menu"`; (c) hook the dialog's own `onhide` callback; (d) stop the dialog's Escape keydown from reaching the Desk's global handler. | The control opens a `frappe.ui.Dialog`, or a FilterGroup filter popover for a document-type chart — never a menu — so (a) and (b) misdescribe it to assistive technology; `"dialog"` also covers the non-modal popover. (c) was implemented first and failed: `onhide` runs on `hide.bs.modal`, and the Desk's global Escape handler (`frappe/public/js/frappe/ui/keyboard.js`) blurs the active element a few milliseconds later on the same keydown, leaving focus on `body`. `hidden.bs.modal` runs after that blur, so the restoration survives. (d) would have required changing shared dialog or keyboard code outside this refinement. | The filter popover of a document-type chart is still not dismissible with Escape (no Escape binding in `frappe/public/js/frappe/ui/filters/filter_list.js`), which is pre-existing behaviour this refinement does not change; the focus restoration applies once that popover closes by any other means. |
| RD-3 | The applied option of a single-selection widget dropdown is marked with `role="menuitemradio"` and `aria-checked="true"`, the other options with `aria-checked="false"`, and the applied one additionally carries Bootstrap's `.active` class. At render time the option to mark is identified in `render_chart_filters` by matching the option's text — raw and translated — against the control's applied label; from the first selection onwards `mark_selected_dropdown_option` moves the marking. | (a) `aria-current="true"` on the applied option, leaving `role="menuitem"`; (b) `aria-selected`; (c) a visible check icon only; (d) rely on the control's label, which already shows the applied value. For identifying the initially marked option: (e) persist the applied value in a data attribute on the dropdown and compare against it; (f) have the caller pass the applied option in to `render_chart_filters`; (g) mark nothing until the user makes the first selection. | `menuitemradio` with `aria-checked` is the WAI-ARIA pattern for a menu whose options are mutually exclusive, and it is the one that makes readers announce both the state and its absence on the other options. `aria-current` describes a location rather than a choice; `aria-selected` is not defined for menu items outside a listbox or a tab list; (c) and (d) leave the state visual-only, which is what the review feedback asked to fix. Label matching is used for the initial marking because the filter label always shows the setting that is currently applied, so it is the only representation of the applied value present at render time: `render_chart_filters` receives the option list and the label, not the applied value. (e) would have to be written and kept in step by every caller that changes a label, and (f) would change the helper's signature and the filter objects its one caller (`chart_widget.render_time_series_filters`) builds for the timespan, interval and heatmap-year dropdowns; (g) would leave a menu whose options are all `aria-checked="false"` until the user touches it, which is the state the ARIA pattern reserves for "nothing applied". | `.active` is the secondary, visual indicator only — the requirement is carried by `aria-checked`. The framework renders `.dropdown-item.active` as white text on `#7c7c7c` (about 3.9:1), below WCAG AA for normal text; the token is `$component-active-bg` in `frappe/public/scss/desk/variables.scss` and is reported to the work unit that owns the contrast tokens (directive D7) rather than changed here. The initial marking is by text: two options whose translated text is identical would both be marked, and a label a caller sets outside the helper is matched only if it is one of the option texts — after the first selection the marking no longer depends on the label. |
| RD-4 | `frappe.dashboard_utils.make_dropdown_keyboard_operable` handles the menu keys itself (Enter, Space, ArrowDown, ArrowUp, Home, End, Escape, Tab) and calls `stopPropagation`, instead of extending or relying on Bootstrap's own keydown handling. Escape is claimed only while the menu is open; with the menu closed the key is left to the document, so the Desk's global Escape handling still reaches a focused toggle. | (a) Rely on Bootstrap 4.6.2's `_dataApiKeydownHandler`; (b) keep Bootstrap's handling and add only the missing keys; (c) replace Bootstrap's dropdown plugin. | Bootstrap's handler reacts to ArrowUp, ArrowDown and Escape only (its key filter is `/38\|40\|27/`): it does not move focus into the menu when the menu opens, does not wrap at either end, has no Home or End, and reaches Space only for text inputs. Under (b) the two handlers would both act on the same key press and fight over the focused item; handling the keys locally and stopping propagation keeps one owner per key and leaves Bootstrap to open, close and position the menu. (c) would touch every dropdown in the Desk. | Keys handled on a widget menu no longer reach document-level handlers, which is the intent (Escape in a menu closes the menu and nothing else). A future Bootstrap upgrade that adds this behaviour would make the local handler redundant, not wrong. |
| RD-5 | Focus is restored from one `hidden.bs.dropdown` handler per dropdown, and only when the toggle is still in the document and focus is on `body`, inside the menu that just closed, or nowhere. Two closes are exempt: one performed by a Tab or Shift+Tab keypress, and one whose command navigates away — chart `Edit`, the `{doctype} List` and `{report} Report` commands and Number Card `Edit` call `frappe.dashboard_utils.suppress_menu_focus_restore()` immediately before their `frappe.set_route(...)`, and the close handler consumes that suppression instead of restoring focus. | (a) Restore focus separately in each close path (Escape, outside click, activation); (b) restore unconditionally on every close; (c) restore nothing and let the browser decide; (d) mark the navigating commands with a data attribute on the rendered anchor and read it in the close handler; (e) capture the route when the menu opens and compare it with the current route after the close; (f) leave the navigating commands restoring focus and rely on the destination page to take it. | `hidden.bs.dropdown` is the one event every close path goes through — Escape, an outside click, activating an option, and a programmatic close — so one handler covers them all and cannot miss a path, which (a) demonstrably did. The guard is what makes an action that deliberately moves focus (a dialog that takes it, a route change that discards the widget) keep it, which (b) would override. (c) is the reported defect: an outside click left the keyboard on `body`. Tab and Shift+Tab are exempt because the keypress itself is a request to move focus on, which the restoration would undo. The navigating commands need an exemption the generic handler cannot derive: `frappe.set_route()` is asynchronous, while Bootstrap's `_clearMenus` closes the menu synchronously during the same click dispatch, so at close time the route has not changed yet — which rules out (e) — and the old toggle is still connected and still holds the guard's conditions, so the handler pulls focus onto a control the route change then discards, which is (f) and the defect reported against it. (d) would have to be written into `set_chart_actions` and `set_card_actions`, which render every command from the same label/action/handler triple and know nothing about what a handler does. A flag the command sets itself is the one signal available at the moment of activation, and because `_clearMenus` is bound on `document` it always runs after the command's own handler — for a mouse click and for the keyboard path, which activates the command with `trigger("click")` and bubbles the same way. | An action that moves focus asynchronously after the menu closes wins over the restoration, which is the intended order. A widget that rebuilds its control row (chart "Refresh") restores focus through the chart widget's own `action_area_holds_focus` path instead, because the original toggle is gone by then; both paths end with the toggle focused. The suppression is one shared flag on `frappe.dashboard_utils`: it is consumed by the first close that follows and otherwise dropped at the end of the current task, so a command that closes no menu cannot suppress a later close — but a menu command added later that routes away without calling the suppressor gets the unsuppressed behaviour, and a navigation that never completes leaves focus on `body`, because the menu item it was on is hidden together with the menu. |
| RD-6 | The existing Cypress assertion `role="menuitem"` on the first timespan option was updated to `role="menuitemradio"`; every other existing assertion in that `it` block is untouched, and the block still runs. | (a) Keep `role="menuitem"` on the filter options and mark the applied one some other way; (b) add both roles; (c) delete or replace the original `it` block. | The option role is exactly what RD-3 changed, so the assertion encoded the pre-refinement value and had to follow it. (a) would have abandoned the chosen ARIA pattern to keep a test green; (b) is not valid ARIA; (c) is forbidden — the spec is extended, not replaced. | A reader of the original test sees the role change in the diff; the accompanying new `it` block asserts the full checked-state behaviour, so the change is covered rather than merely relaxed. |
| RD-7 | A menu is always closed by triggering a click on its toggle, never by `$toggle.dropdown("hide")`. | (a) Call Bootstrap's `hide()` and fix `aria-expanded` afterwards; (b) remove the `show` classes directly. | In Bootstrap 4.6.2 only `Dropdown._clearMenus` resets `aria-expanded` to `false`; `hide()` leaves it at `true`, so (a) would announce an open menu to assistive technology after the menu closed, or would need the attribute patched in two more places. Clicking the toggle is the path Bootstrap itself uses for its Escape handling, and it fires `hidden.bs.dropdown` exactly once. | The synthetic click is dispatched through jQuery, whose own re-entrancy guard keeps the native click from running the handlers a second time. |
| RD-8 | The keyboard behaviour is bound per rendered dropdown, with a `keyboard-operable` data flag guarding against a second binding on the same node, rather than once globally on `document`. | (a) One delegated set of handlers on `document` for all widget menus; (b) no guard, relying on each render producing new nodes. | Widgets discard and rebuild their control row on refresh, so per-node handlers are collected with the nodes and nothing accumulates; a global delegated listener would instead apply to every `.dropdown-menu` in the Desk, including menus this refinement does not own. The flag makes a repeated call on the same node a no-op, which is what (b) cannot promise for callers that re-run the helper on an existing dropdown. | Each rendered menu carries its own handlers; the cost is a handler pair per menu, which matches how the widgets already bind their click handlers. |
| RD-9 | Name every widget menu after the control that opens it: `frappe.dashboard_utils.label_dropdown_menu($toggle, $menu)` sets `role="menu"` when the menu carries no role and points `aria-labelledby` at the toggle's id, obtaining that id from `frappe.dom.set_unique_id`, which returns an existing id unchanged and otherwise assigns a generated `unique-<n>`. | (a) `aria-label` on the menu carrying a literal or copied string; (b) hard-coded static ids on each toggle; (c) use `aria-labelledby` only for toggles that already have an id and leave the rest unnamed; (d) leave every menu unnamed, as before. | One dashboard renders several structurally identical menus — chart actions, timespan, interval and heatmap year per chart widget, plus Card Actions per tile — so an unnamed menu is indistinguishable by ear, which is the D10.9 gap this closes. `aria-labelledby` reuses the toggle's own accessible name, so the two cannot drift: the timespan and interval toggles are labelled with their current value, which changes on every selection, and an `aria-label` copy (a) would have to be rewritten at each selection and would go stale silently in between. Static ids (b) are unusable because the widgets render many times per page and again on every rebuild, and duplicate ids would resolve `aria-labelledby` to the wrong toggle. (c) would leave the framework's own toggles unnamed, since they ship without ids. | The generated id is written onto a framework-owned toggle element, so its value differs between renders and page loads; nothing in the repository selects on `#unique-…`, but anything that did would be matching an unstable value. A toggle that is rebuilt takes a new id, so the name is re-established per render rather than persistent. An element that already carries an id keeps it, which means the menu's name follows whatever that pre-existing id labels. |
| RE-1 | Keyboard tooltip navigation is a focus-scoped `keydown` handler on the chart widget's plot area; frappe-charts' own `isNavigable` option is not used and `frappe.utils.make_chart` is left unchanged. | (a) Pass `isNavigable: 1` through `make_chart`; (b) bind a document-level `keydown` in the widget and filter by which chart is on screen. | `isNavigable` binds a listener on `document` that acts on key codes 13/37/38/39/40 whenever the chart container is fully inside the viewport, so it would fire for whichever chart happens to be in view and would swallow the arrow keys the widget's own dropdowns rely on; it also drives frappe-charts' overlay/`data-select` mechanism rather than the tooltip the reviewer asked to reach. A handler on the focused element only reacts while that chart has focus, and reuses the tooltip the pointer already shows. | The tooltip is reachable only after focusing the plot area, which adds one tab stop per chart; charts without an x-axis (Pie, Donut, Percentage, Heatmap) get no keyboard tooltip because they expose no `mapTooltipXPosition`. |
| RE-2 | The focusable element is the widget-owned wrapper `div` (`this.chart_wrapper`, marked `.chart-plot-area`), not the `.chart-container` frappe-charts creates inside it. | (a) `.chart-container`; (b) `svg.frappe-chart`. | The wrapper survives both `dashboard_chart.update(data)` and the full chart re-creation the widget performs for circular charts and on "Refresh" — frappe-charts clears the parent's `innerHTML` and builds a fresh `.chart-container` — and the widget creates the wrapper itself, so the ARIA attributes and handlers live where the widget controls the lifecycle. Because `setup_container()` builds a new wrapper on every `make_chart()`, the once-per-element binding guard cannot accumulate listeners. | The focus ring outlines the wrapper, which is marginally larger than the chart; a future frappe-charts version could insert additional nodes between wrapper and chart. |
| RE-3 | The existing mouse `bind_plot_area_tooltip()` stays gated on `valuesOverPoints` and is not extended to other charts. | (a) Bind the widget's own `mousemove` for every axis chart; (b) drop the widget binding and rely entirely on the library. | frappe-charts' `AxisChart.bindTooltip()` already maps any pointer position inside the plot band to the nearest data point when `valuesOverPoints` is falsy — confirmed at runtime on the Line trend chart — and narrows to `.data-point-value` targets only when values are printed over points, which is exactly the gap the widget binding fills. Extending it would duplicate the library's handler on line charts. | A future frappe-charts release that changes `bindTooltip` would leave non-`valuesOverPoints` charts without a plot-area mouse tooltip; the keyboard path is unaffected because it calls `mapTooltipXPosition` directly. |
| RE-4 | Key map: <kbd>→</kbd>/<kbd>←</kbd> step one data point and clamp at the ends, <kbd>Home</kbd>/<kbd>End</kbd> jump to the first/last point, <kbd>Enter</kbd>/<kbd>Space</kbd> re-show the current point, <kbd>Esc</kbd> hides; `preventDefault()` is called only for those keys. | (a) Wrap around at the ends; (b) use <kbd>↑</kbd>/<kbd>↓</kbd> for stepping as `isNavigable` does; (c) make <kbd>Enter</kbd> drill through to the document list. | Clamping pairs with <kbd>Home</kbd>/<kbd>End</kbd> and keeps the ends of the axis discoverable, whereas wrapping silently moves a keyboard user from the last day to the first with no signal. Leaving <kbd>↑</kbd>/<kbd>↓</kbd> and <kbd>Tab</kbd> untouched keeps page scrolling and the widget dropdowns working, which the reviewer's menu directive depends on. Drill-through is a separate behaviour already offered by the chart menu. | Walking a long axis takes one press per point (<kbd>End</kbd> mitigates); users who expect wrap-around get no movement at the ends. |
| RE-5 | The plot area is `role="group"` with an `aria-label` that names the chart and the interaction; no `aria-roledescription` is set. | (a) `role="img"`; (b) `role="application"`; (c) `role="group"` plus `aria-roledescription="chart"`. | `role="img"` declares the subtree a single static graphic, which contradicts a focusable element whose arrow keys change what is announced; `role="application"` suppresses the reader's own navigation for everything inside. `group` keeps the plot area a labelled composite while the live region carries the changing content, and the label already contains the word "chart", so `aria-roledescription` would only add verbosity on the readers that support it. | "group" conveys less about the content type than a chart-specific role would; the label is the only thing telling the user what the arrow keys do. |
| RE-6 | One visually hidden `aria-live="polite" aria-atomic="true"` node per chart widget, reused for every move, holding "<title>: <series> <value>, …"; cleared on <kbd>Esc</kbd> and on blur. | (a) `aria-live="assertive"`; (b) make the library's `.graph-svg-tip` itself the live region; (c) one shared live region for the whole dashboard page. | `polite` lets the reader finish the phrase in progress instead of interrupting on every arrow press, and `atomic` makes it read the whole data point rather than only the changed part. The tooltip node is owned, positioned and hidden by frappe-charts (it only toggles opacity, so stale text stays in the DOM) and its title is upper-cased by CSS, so mirroring the content into a node the widget owns keeps the announcement exact; one region per widget stops two charts from overwriting each other's announcement. | Rapid arrow sequences may be coalesced or queued by the reader; the announcement text duplicates the tooltip, so any future wording change must be made in both places. |
| RE-7 | The announcement text is built from `chart.dataByIndex[index]` (the structure frappe-charts fills the tooltip from) rather than read back out of the tooltip DOM. | Scrape `.title`, `.tooltip-value` and `.tooltip-label` from `.graph-svg-tip` after showing it. | `dataByIndex` holds the same label and the same `formatted` value the tooltip prints, so the spoken and visual content cannot drift, and the announcement does not depend on the tooltip's markup or on the CSS `text-transform` applied to its title. | Couples the widget to a frappe-charts internal — the same coupling the delivered mouse binding already has through `mapTooltipXPosition`. |
| RE-8 | No stylesheet change: the plot area relies on the browser's native focus ring. | Add a `.chart-plot-area:focus-visible { box-shadow: var(--focus-default); }` rule to `frappe/public/scss/desk/desktop.scss`. | The Desk's global `outline: 0` reset applies only to `a` and `.btn`, so a focusable `div` keeps a visible native focus ring — verified in the browser at 1440px and at 375px — and the Desk stylesheet is being changed by the contrast work in this same refinement, so adding a competing rule here would collide with it. | The native ring does not use the Desk focus token, so it looks different from the button focus style; flagged for the unit that owns `desktop.scss`. |
| RE-9 | The keyboard-tooltip Cypress case seeds two ToDos through the spec's `seed_doc` registry — one allocated to `Administrator`, one to `Cypress.config("testUser")` — so the single-series Top Owners axis holds at least two data points, and reveals the first tooltip through `reveal_first_point(title)`: it first retries until the chart's `svg.frappe-chart` holds no `animate`/`animateTransform` node, focuses the plot area, and then, inside one retried `should`, dispatches a native `keydown` on the plot area (ArrowRight on the first attempt, Home on every later one, each carrying its key code) until `.graph-svg-tip` reports `opacity: 1` with text matching that chart's own series (`Created\|Completed`, `Open ToDos`). No fixed `cy.wait(ms)` remains in the spec. | (a) One fixed `cy.wait` sized to the entry animation; (b) wait on a frappe-charts animation-completion event or promise; (c) disable or stub the library's animation for the test; (d) add a readiness event to the widget for the test to wait on; (e) assert on the second data point only and never touch the first; (f) re-press the key up to ten times at a fixed 500 ms interval, which an earlier draft of this case did. | frappe-charts renders placeholder series while its entry animation runs, so the first keyboard move can land on a point that does not exist yet and read an empty or placeholder tooltip. The library exposes no completion event or promise, which removes (b), and no public switch to turn the animation off for one chart, which leaves (c) as a patch to a vendored library for a test's benefit. (d) would add production code whose only consumer is the spec, against the refinement's minimal-change constraint. A fixed wait (a) and a fixed-interval re-press (f) are the flakiness this replaces — too short on a loaded host, wasted time on an idle one — whereas waiting on the SMIL nodes the library itself removes when the animation ends, and then retrying against the chart's own rendered state, stops as soon as the chart is ready and is bounded by Cypress's command timeout rather than by a sleep count. Seeding two owners is what makes movement along the Top Owners axis observable at all: with one bar, ArrowRight has nowhere to go and the assertion would be about the clamp rather than about the move. | A chart that never settles fails at the Cypress command timeout with a tooltip-content mismatch rather than a timeout message, which reads as a data failure. The polled predicate matches the series names, so renaming a dataset breaks the reveal rather than the assertion that follows it. The two seeded ToDos are ordinary records; the spec's `afterEach` deletes every document `seed_doc` registered, newest first, and asserts each deletion returned `ok`, so a run that stops before the hook — or a deletion the server refuses — is the only way they persist. |
| RE-10 | <kbd>Esc</kbd> on the plot area is contained there: the handler calls `preventDefault()` and `stopPropagation()`, hides the tooltip, clears the live region and returns with focus still on the plot area. No other key the handler consumes stops propagation. | (a) `preventDefault()` only, which is what the first implementation did; (b) let the key propagate and re-focus the plot area afterwards; (c) change the Desk's global Escape handling in `frappe/public/js/frappe/ui/keyboard.js` so it does not blur a focused plot area; (d) stop propagation for every key the plot-area handler consumes. | The Desk's global handler is a bubbling `keydown` on `window` whose Escape branch calls `document.activeElement?.blur()` unconditionally, so Escape dismissed the tooltip and then dropped focus from the plot area to `body`, losing the keyboard user's place in the chart. (b) races the same key press against the blur; (c) changes shared keyboard behaviour for every focusable element in the Desk, which this refinement does not own; (d) would suppress document-level handling for keys that do not conflict — arrows, <kbd>Home</kbd> and <kbd>End</kbd> have no global binding and the global <kbd>Enter</kbd> handler acts only while a confirm dialog is open — so the suppression is kept to the one key that demonstrably conflicts. | An ancestor or document-level Escape listener no longer sees an Escape pressed while a chart plot area holds focus: there, Escape dismisses the tooltip and does nothing else. This matches RD-4, which keeps one owner per key inside a widget. |
| RE-11 | Every fragment of the announcement — the point title, each dataset title and each formatted or raw value — is passed through one helper that stringifies it, strips markup with `strip_html`, decodes HTML entities with `frappe.utils.unescape_html` and trims; a fragment that normalises to an empty string is left out of the announcement. | (a) Insert the `dataByIndex` values unchanged, which announced `Sales &amp;amp; Returns` for a series named `Sales & Returns`; (b) decode through `frappe.utils.html2text`/`DOMParser`; (c) decode entities without stripping markup; (d) read the rendered `.graph-svg-tip` text back out of the DOM (already rejected in RE-7); (e) decode the dataset title only and leave labels and values as they are. | frappe-charts escapes `<`, `>` and `&` in dataset names before storing them in `dataByIndex` (`AxisChart.calcDatasetPoints`) and renders its tooltip through `innerHTML`, so the visible tooltip showed the original characters while the live region — written with jQuery `.text()` — received the entity text. Stripping and then decoding makes the spoken text equal the seen text for all three fragment kinds. (b) parses every fragment through the DOM on each arrow key for the same result on the entities frappe-charts writes; (c) would leave markup produced by a chart's own `formatTooltipX`/`formatTooltipY` formatter in the announcement; (e) leaves the label and value paths inconsistent with the title path. | `unescape_html` decodes the framework's own entity set (`&amp;amp; &amp;lt; &amp;gt; &amp;quot; &amp;#39; &amp;#x60; &amp;#x3D;`), so a numeric entity outside it is announced as written. The order is load-bearing: stripping first and decoding second means a name whose escaped form reads like a tag (`&amp;lt;b&amp;gt;`) is announced literally, which is what the tooltip shows. The announcement is inserted with `.text()`, so decoding cannot put markup into the page. |
| RF-1 | Override `--focus-default` and `--focus-outline-default` as scoped custom properties on `.dashboard-page, .widget-group, .widget` (and a dark-theme variant) in `desktop.scss`, rather than raising the token globally. | (a) Change `--focus-default` in `frappe/public/css/espresso/effects.css` globally; (b) write a literal `box-shadow` on each widget control and set no token. | `grep` found 13 consumers of `--focus-default` — `global.scss` (`a`, `.btn`, `.btn-reset:focus-visible`), `buttons.scss` (`.btn:active`, `.btn-secondary`, `.btn-ghost`, `.btn-default`), `filters.scss`, `frappe_datatable.scss`, `checkbox.scss`, `css_variables.scss`, `dark.scss` — which paint the focus ring of every button, link, checkbox, datatable cell and filter on list views, form views, the navbar and modals. D7 forbids changing a token other pages rely on without confirmation, so (a) is out. (b) would leave the token inconsistent with the ring actually painted and would miss controls added later. | The override applies to every Desk surface that renders widgets, not only the dashboard — Workspaces included. That is inside the directive's "Desk dashboard/widget surfaces" scope, and it is the reason the regression check covers list and form views rather than Workspaces. |
| RF-2 | Use `var(--ink-gray-6)` as the ring colour and keep the existing geometry (2px light, 3px dark). | (a) `var(--ink-gray-5)`; (b) `var(--outline-gray-4)`, which the theme cards already use for focus; (c) a literal hex per theme; (d) a single geometry for both themes. | `--ink-gray-6` is one existing design-system token that satisfies AA in both themes with margin: 7.81:1 against `--card-bg` and 7.04:1 against `--control-bg` in light (`#525252`), 6.29:1 and 5.11:1 in dark (`#999999`), against a 3:1 requirement. `--ink-gray-5` reaches only 3.76:1 against `--control-bg` in light and 3.39:1 in dark; `--outline-gray-4` is `#999999` in light, which is 2.85:1 against white and fails. (c) would hardcode colour outside the token system. Keeping the geometry means the only visible change is the hue. | The ring is visually heavier than the near-white original. That is the intended outcome of the directive, but it is a deliberate departure from the shipped visual style. |
| RF-3 | Fix the input placeholder with an explicit `.widget ::placeholder` rule **and** a scoped `--placeholder-color` override, rather than the token alone. | (a) Override `--placeholder-color` only; (b) override `--gray-500` inside the widget scope; (c) change `$input-placeholder-color` in `frappe/public/scss/desk/variables.scss`. | The rule that actually paints the placeholder is bootstrap's compiled `.form-control::placeholder { color: var(--gray-500) }`, built from `$input-placeholder-color`, so (a) changes nothing observable — `--placeholder-color` has no consumer selector at all. (b) would repaint every other use of `--gray-500` inside a widget. (c) is a global change affecting every input in the Desk. The token is still set so the documented placeholder token and the painted colour agree on these surfaces. | Placeholder text now resolves to the same value as `--text-muted`, so a placeholder and muted body text look alike; the typed value stays `--text-color` and remains distinguishable. |
| RF-4 | Raise the chart loading / "No Data" text with `.widget .text-extra-muted { color: var(--ink-gray-6) !important }`. | (a) Raise `--ink-gray-5` globally; (b) change `.text-extra-muted` in `global.scss`; (c) target only `.chart-loading-state.text-extra-muted`. | This is the surface behind the review's "placeholder text at 3.93:1": `global.scss` line 637 sets `.text-extra-muted { color: var(--ink-gray-5) !important }`, and `--ink-gray-5` on `--subtle-accent` measures exactly 3.930:1. `--ink-gray-5` has 44 consumers across the breadcrumb, sidebar, menu, calendar, controls, six espresso component stylesheets, five JS files and the login, signup and update-password pages, so (a) is out under D7. (b) is a global class change. `!important` is required because the rule being overridden carries it. (c) would leave other extra-muted text inside widgets failing. | The `!important` is scoped to `.widget`; a regression probe confirmed `.text-extra-muted` still resolves to `--ink-gray-5` on list and form views. |
| RF-5 | Set `.dashboard-widget-box .chart-loading-state.text-danger { color: var(--ink-red-8) !important }`. | (a) `var(--ink-red-7)`; (b) a per-theme literal hex; (c) change `$danger` in `frappe/public/scss/espresso/_colors.scss`; (d) omit `!important`. | `--ink-red-8` is the one red token that satisfies AA in both themes: light `#b41d1d` gives 6.31:1 on `--subtle-accent`, dark `#ff7575` gives 6.32:1. `--ink-red-7` reaches only 4.45:1 in dark, just under the threshold. (c) would repaint every danger colour in the Desk. (d) was tried first and is dead code: bootstrap's `text-emphasis-variant` mixin emits `.text-danger { color: #e03636 !important }`, which outranks any non-important rule regardless of specificity — the first runtime measurement caught the error text still painting `rgb(224, 54, 54)`. | Chart error text is a noticeably darker red in light mode and a lighter red in dark mode than `.text-danger` elsewhere in the Desk, so the danger colour is not uniform across surfaces. |
| RF-6 | Scope the breadcrumb fix with `body[data-route^="dashboard-view"] .navbar-breadcrumbs a`, using the `data-route` attribute `frappe/public/js/frappe/views/container.js` sets on `body`. | (a) Raise `var(--ink-gray-5)` to `--ink-gray-6` in `frappe/public/scss/desk/breadcrumb.scss` for all routes; (b) raise `--ink-gray-5` globally; (c) scope by a class on the dashboard container. | Breadcrumbs live in the navbar, outside any `.widget`, so a widget-scoped selector cannot reach them; the route attribute is the only hook that limits the change to the Desk dashboard surface the directive names. (a) and (b) would change the breadcrumb colour on every Desk page and, for (b), 44 other consumers — neither is confirmed by the grep, so D7 rules them out. (c) fails because the Desk `dashboard-view` page renders `<div class="dashboard">`; `.dashboard-page` belongs to the separate Workspace dashboard view. | Breadcrumbs remain at 4.17:1 on every other Desk route. Raising them everywhere is a reasonable follow-up but needs the confirmation D7 requires, and the review scoped this work to the dashboard. |
| RF-7 | Raise the breadcrumb `/` separator (`a:before`) to `var(--ink-gray-5)` rather than leaving it decorative. | (a) Leave it at `--ink-gray-4` and record it as decorative; (b) raise it to `--ink-gray-6` like the link. | The separator is a `content: "/"` pseudo-element that conveys no information, so AA text contrast does not strictly apply, but at 2.85:1 in light it also missed the 3:1 UI-component floor. `--ink-gray-5` clears it at 4.17:1 light and 4.18:1 dark with one token, at negligible visual cost. (b) would make the separator as prominent as the link and flatten the visual hierarchy. | None identified; the separator stays lighter than the link in both themes. |
| RF-8 | In the Cypress assertion, read the focus-ring colour from the focused control's computed `box-shadow` when it carries a colour, and otherwise from its resolved `--focus-default`. | (a) Assert only on the computed `box-shadow`; (b) assert only on the token; (c) skip the focus-ring assertion and rely on the runtime screenshots. | Chrome matches `:focus-visible` on a programmatic focus only when the last input modality was the keyboard, and the synthetic clicks a Cypress run performs set the pointer modality, so (a) is flaky — it can read `none` and fail for a reason unrelated to contrast. The token is the exact value the browser paints when the ring does appear, so the fallback keeps the assertion meaningful. (c) would leave the fix without automated coverage, which D10.6 asks for. | The assertion can pass on the token while the painted ring is suppressed by an unrelated cascade change. The painted ring is therefore also verified by pixel sampling in the runtime evidence, and listed as a manual check in section 4. |
| RF-9 | Implement WCAG 2.1 contrast inside the Cypress case rather than importing it: a small CSS colour parser (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, and the first colour out of a compound value such as a `box-shadow`), alpha compositing of a translucent foreground over its background, the sRGB relative-luminance formula with the 0.03928 knee and the 0.2126 / 0.7152 / 0.0722 coefficients, the `(L1+0.05)/(L2+0.05)` ratio, and an ancestor walk that takes the first ancestor painting a background other than `transparent` / `rgba(0, 0, 0, 0)` as the effective background, defaulting to white. Every input is read from `getComputedStyle` in the running Desk. | (a) Add `cypress-axe`/`axe-core` or a contrast npm package; (b) assert the resolved token values against a table of ratios measured once by hand; (c) compare screenshots or sample pixels; (d) leave the ratios to the manual measurement recorded in §7. | A dependency (a) is ruled out by D1: `package.json` and `yarn.lock` must stay byte-identical, CI asserts the lockfile is unchanged, and `run-ui-tests` installs Cypress itself with `--no-lockfile` — and an axe audit would report a whole-page result rather than the named surfaces the directive lists. (b) proves the stylesheet rather than the rendered colour, and the defect this unit actually fixed (RF-5) was a rule that lost the cascade to a bootstrap `!important`, which a token table would have scored as passing. (c) yields a difference, not a ratio, and is the least stable thing available in a headless run. Computing from computed styles is the only form that measures what the browser paints at the element the requirement is about, and compositing is required because the shipped ring is a translucent `rgba()` over an opaque card — the pre-refine `#c9c9c9e5` — which an uncomposited ratio misreports. | The parser covers the forms the Desk resolves to and returns `null` for `hsl()`, `color-mix()`, `color(display-p3 …)` or a named colour, so such a value fails the assertion for being unreadable rather than for failing contrast. Taking the first colour of a compound `box-shadow` assumes the ring's colour leads the value; RF-8's token fallback covers the case where no colour is present at all. The background walk stops at the first painted ancestor, so a background image, a gradient or a stack of translucent ancestors is not modelled, and nothing painted anywhere resolves to white. The maths is a second implementation of the §7 measurement, so the two have to stay in step. |
| RG-1 | Apply the affordance class in `NumberCardWidget.set_body()` (`this.widget.addClass("number-widget-box widget-shadow")`), which makes the framework's existing but dead `.widget.widget-shadow:hover` rule live for Number Card tiles only. | (a) Honour `opts.shadow` generically in `base_widget.make_widget()`, which would add `widget-shadow` to every widget that sets it — chart, number card, shortcut, quick list and custom block; (b) add a brand-new tile-specific class and rule instead of reusing `widget-shadow`. | The directive asks for a hover affordance on Number Card tiles, and (a) changes five widget types across every Desk surface — a framework-wide behaviour change needing maintainer sign-off under Section 5.2 and carrying a much larger regression surface for one tile's affordance. (b) would duplicate a rule the framework already ships. Applying the existing class at the one widget that was asked for keeps every edit inside the twelve Section C files. | The `opts.shadow = true` flag stays unused for the other four widget types, so the same dead-rule inconsistency remains for them; a future maintainer honouring `opts.shadow` in `base_widget.js` will make the class redundant here (harmless — the class would simply be applied twice). |
| RG-2 | Make the tile element itself the keyboard control, and derive its semantics from the widget's current state rather than applying them once at construction. A single `update_tile_operability()` runs on every render, on entry to customize mode (through an overriding `NumberCardWidget.customize()`) and again once `get_data()` has resolved, and decides whether the tile is a control at all. A tile that resolves to a destination carries `role="link"`, `tabindex="0"`, an accessible name stating that destination — `"<card title>: open the <document type> list"`, `"<card title>: open <single document type>"`, `"<card title>: open the <report> report"`, or `"<card title>: open <route target>"` for a Custom card, whose destination is the last meaningful segment of `data.route` — and a namespaced `keydown` handler that maps Enter and Space to the same `set_route()` the body click calls, re-checks `in_customize_mode` at event time and stands down unless the event target is the tile element itself. A tile in customize mode, or one that resolves to no destination (card document not loaded yet, Document Type card without a document type, Report card without a report, Custom card whose data carries no route), has the role, the tab stop, the accessible name and the key handler removed by `make_tile_inoperable()`. | (a) Keep the name the constant `"<card title>: open list"` for every card type; (b) keep applying the attributes once behind the construction-time `in_customize_mode` guard and rely on the handler's event-time re-check to disable activation; (c) add a mode-transition hook (or honour `opts.shadow`) in `base_widget.js` so every widget type is notified of the change; (d) name a Custom card generically ("open linked page") instead of from its route; (e) keep `role="link"` on a Custom card with no route and let activation no-op; (f) put the attributes and the handler on the clickable `.widget-body` instead of the tile; (g) omit the target guard and handle every key that bubbles up from inside the tile; (h) make the tile focusable in customize mode too; (i) leave the tile mouse-only, as it was. | The tile is the control a user sees and the element the hover and focus CSS applies to, so it is the element that must take focus — (f) would leave the focus ring on an inner box, away from the affordance. (i) leaves the card's primary action unreachable by keyboard, which the directive's keyboard-parity clause rules out, and (g) would hijack Enter and Space on the nested "Card Actions" dropdown, which owns those keys. (a) is untrue for two of the three card types: a Report card routes to `query-report/<report name>` and a Custom card routes wherever its data says, so "open list" names a destination those tiles do not have. (b) is the defect the delta had: the doctype dashboard's "Customize Dashboard" action calls `Widget.customize()` on already-rendered widgets instead of rebuilding them, so the tile kept its link role, tab stop, name and handler while activation was disabled — a focusable control announced as a link that does nothing. Deciding the semantics from current state is the only form that survives a mode change in either direction; leaving customize mode rebuilds the widgets, and the rebuild reapplies the semantics through `set_events()`. (c) would put a hook on the chart, shortcut, quick-list, links, onboarding and custom-block widgets for one widget type's need — the framework-wide change RG-1 declined, in a file outside the twelve that D14 would make us flag. (d) drops the destination the name is supposed to carry, and by the time the name is computed the route is known. (e) keeps announcing a link whose activation is a no-op, which is the defect rather than a fix. (h) would add tab stops to a drag-and-drop editing surface where the tile does nothing, and shortcut tiles are not focusable there either. | The tile is a `role="link"` that contains another interactive control (the Card Actions menu button); this mirrors the shipped shortcut tile pattern but is not ideal ARIA, and screen-reader announcement of the pair is listed in §4 as needing manual verification. A Custom card is named from its route's last meaningful segment, so `["Form", "ToDo", "TODO-0001"]` announces "open TODO-0001" and a slugged path route announces the slug — truthful but terse. The name is recomputed only when operability is updated, so a card document mutated at runtime without a re-render keeps the previous name until the next render. Single document types are recognised through `frappe.model.is_single`, that is from `frappe.boot.single_types`, so a boot payload missing the doctype would name its destination as a list. `base_widget.js` is left unchanged, so D8 touches no file outside the twelve. The shipped shortcut tile applies the same attributes once, in `set_actions()`, and therefore keeps the same latent gap on any surface that switches a live shortcut widget into customize mode; that widget is outside this refinement's scope. |
| RG-3 | Treatment = the shortcut tile's border change (`border-color: var(--invert-neutral, currentColor)`) plus the `widget-shadow` elevation (`box-shadow: var(--shadow-base)`), applied to `:hover`, `:focus-visible` and `:focus-within`, with `var(--focus-default)` added as a leading shadow layer and `outline: 0` on `:focus-visible` only, over a 0.2s transition. The shortcut tile's title-colour shift and its `--icon-stroke` override were deliberately not copied. | (a) Copy the shortcut tile's hover block verbatim, including `.widget-title { color: var(--invert-neutral) }` and `--icon-stroke: var(--invert-neutral)`; (b) use only the border change; (c) use only the elevation; (d) write a bare `var(--invert-neutral)` with no fallback, exactly as the shortcut tile does. | `--invert-neutral` is referenced by six stylesheets but defined nowhere in `frappe/public`, so (d) renders only because the declaration is invalid at computed-value time and falls back to `currentColor`; naming that fallback explicitly renders identically today and stays deterministic if the token is ever defined badly. Copying the title-colour shift would move the title from `#171717` to a lighter inherited grey, lowering contrast in the middle of the WCAG contrast work under D7, and copying the `--icon-stroke` override makes the tile's "…" icon lose its stroke and disappear on hover. Combining border and elevation guarantees a visible change even where one of the two is overridden. | If `--invert-neutral` is later defined, the hover border colour changes with it — intended. On `[data-page-route="Workspaces"]` pages the pre-existing `.widget.number-widget-box { border: 1px solid var(--border-color) }` override has equal specificity and comes later in the stylesheet, so a workspace-embedded tile keeps its flat border and shows only the elevation and the focus ring. `:focus-within` means the tile also lifts while its nested Card Actions menu has focus. |
| RG-4 | Prove the tile's `:hover` treatment by rule presence: the Cypress case walks `document.styleSheets`, skips any sheet whose `cssRules` access throws, collects every `selectorText` and asserts at least one matches `/number-widget-box[^,{]*:hover\|widget-shadow:hover/`. The focus half of the same affordance is exercised on the element itself — focus the tile, then compare its computed `box-shadow` and `border-color` with the unfocused baseline. | (a) Drive a real pointer so the browser matches CSS `:hover`; (b) force the pseudo-class through CDP (`Emulation.forcePseudoState`) from a Cypress task; (c) screenshot or pixel-diff the hovered tile; (d) assert nothing about hover and cover only focus; (e) read the matching rules with `getMatchedCSSRules`. | Cypress dispatches synthetic events, which do not put the browser into the hover state — `cy.hover()` is deliberately unimplemented — so (a) is not available in this harness, and (e) was removed from browsers. (b) would add CDP task plumbing to the spec for one assertion. (c) has no stable baseline in a headless run, and the painted hover state was already measured by hand: the runtime pixel diff in §7 under "Unit G — tile hover affordance" records 5,357 changed pixels against 134 on the neighbouring tile. Rule presence is the strongest claim an in-page assertion can make without a real pointer, and it is aimed at the way this feature actually breaks: RG-1's change was to make the framework's existing but dead `.widget.widget-shadow:hover` rule apply to the tile, so the rule ceasing to load is the regression. | Rule presence is not proof of a visible state: a loaded rule can lose the cascade to a later override — the workspace `border` override in RG-3's risks is exactly such a rule — or resolve to the same value as the idle state, and this assertion would still pass. The regex is coupled to the selector text, so renaming the class or splitting the rule fails the case even though the affordance works. Sheets that throw on `cssRules` (cross-origin) are skipped silently, so a rule served from another origin would read as absent. The painted state is therefore evidenced by the manual pixel diff in §7, not by this case alone. |
| RH-1 | "Unset" for a filter value means `undefined`, `null`, `""`, a whitespace-only string, or a zero-length array. `0`, `false`, non-empty strings and every array that holds at least one entry — `[""]` and `[null]` included — are set values and are written with their shape intact. | (a) Treat only `undefined`/`null` as unset; (b) treat only `undefined`/`null`/`""` as unset and keep whitespace and `[]`; (c) treat every falsy value as unset (would drop `0` and `false`); (d) also classify an array whose every entry is itself unset as unset — the first implementation, reported as defect F16; (e) an operator-specific rule that judges only the values of `in`, `not in` and `between`. | Scalars follow the framework's own emptiness test, `window.is_null` (`frappe/public/js/frappe/utils/datatype.js:31`), which `frappe.ui.FieldGroup.get_values` (`field_group.js:155`) already applies to manually entered filter values — so an expression-evaluated scalar and a dialog-entered one are judged by the same rule. Arrays deliberately diverge from it: `is_null` coerces with `cstr`, so `is_null([""])` and `is_null([null])` are both true, and honouring that would delete a filter the record really expressed and replace a narrow constraint with none — the F16 defect, and the reason (d) was rejected. A zero-length array stays unset because an `in`/`between` filter with no values expresses no constraint. (c) is rejected outright: `0` and `false` are meaningful filter values. (e) was rejected because the predicate is a one-argument public API (RH-5) with no operator in scope at either call site in `get_all_filters`. | An expression that legitimately yields a padded-blank string (`"   "`) still loses its filter instead of matching blank values. An array of empty or blank entries is now sent to the server, where `IN ('')` matches only rows that hold the empty string — the record's own constraint, but an aggregate of `0` can look like the defect this row fixes. |
| RH-2 | An unset dynamic filter is dropped entirely: the list-shaped row is omitted and the dict-shaped key is never written. The record's static filters are left in place. | (a) Keep the row and rewrite the operator to `["field","is","not set"]`; (b) keep the row with the `null` value (the pre-refine behaviour); (c) `frappe.throw` so the user is told the expression resolved to nothing. | The adjudicated reading of D9 (I-7) is that such a filter is omitted while the static filters stay. (a) would invent a constraint the record never expressed (`allocated_to is not set` is a different query from "no constraint"); (b) is exactly the reported defect — it silently matches nothing and renders a false `0`; (c) would turn a routine unset site default into a blocking error dialog on every dashboard load. | A widget whose only filter is an unset dynamic filter now reports an unfiltered aggregate rather than `0`; a viewer cannot tell from the tile that one filter did not resolve. |
| RH-3 | Empty values entered through the manual filter dialog are left to the existing framework guard; `chart_widget.js` and `number_card_widget.js` are not edited. | (a) Add a guard to `setup_filter_dialog`'s primary action before `save_chart_config_for_user({filters})`; (b) filter `me.filters` through the new predicate in `set_chart_filters()`. | `dialog.get_values()` already drops every `is_null` value before it reaches `me.filters` or the persisted `chart_config` (`field_group.js:155`), so there is no empty write to fix on that path — verified by reading the code and by the runtime capture in section 7, where the only corrupted value came from the dynamic-filter evaluation. Editing the consumer widgets would widen the diff into files owned by other units of this refinement for no behavioural gain. | If a future dialog control returned an empty object or array (which `is_null` does not classify as empty), that value would reach the filter state without passing through `get_all_filters`. |
| RH-4 | `get_all_filters` builds new arrays and objects (`Object.assign({}, filters, evaluated)`, copied `[...f]` rows) instead of mutating the parsed `filters` / `dynamic_filters` in place. | (a) Keep the in-place `Object.assign(filters, dynamic_filters)` / `f[3] = eval(f[3])` and delete the empty keys afterwards. | The dict-shaped defect was precisely an assigned key whose `undefined` value `JSON.stringify` then dropped silently; never creating the key is unambiguous, whereas creating-then-deleting leaves the empty value observable to anything reading the object in between. It also makes the function free of side effects on its input, which the Cypress assertions rely on. | A few extra short-lived objects per widget refresh. |
| RH-5 | The predicate ships as a public member, `frappe.dashboard_utils.is_unset_filter_value(value)`. | (a) A file-local `const` helper; (b) inline the checks in both branches of `get_all_filters`. | The D10.8 Cypress assertion calls it directly in the browser to pin the `0`/`false`/whitespace/empty-array contract, and a single named definition keeps the two branches of `get_all_filters` consistent. | It becomes part of the `frappe.dashboard_utils` namespace surface and is now an API other widget code may depend on. |
| RH-6 | The Cypress `it` additionally creates, exercises and deletes runtime records (Number Card, Dashboard Chart and a Dashboard holding both) carrying an unset dynamic filter, and asserts the intercepted request bodies. | (a) Assert only the in-browser return value of `get_all_filters`; (b) add a dynamic filter to the shipped standard ToDo Analytics records so the existing dashboard exercises the path. | The directive is about what is written into the widget filter state *and sent to the server*, so the wire-level assertion is the one that proves it; the shipped standard records must keep `dynamic_filters_json` empty (other tests and the delivered feature depend on their values), which rules out (b). The Dashboard DocType requires its `charts` table, so a runtime chart is created alongside the card, which also covers the chart consumer. | The test creates and removes three records; a failure between creation and cleanup can leave them on the test site (mitigated by deleting them with `ignore_missing` at the start of the test, making it re-runnable). |
| RI-1 | Mint the session's CSRF token in `frappe/sessions.py` `Session.start()` for every non-Guest session, rather than in `LoginManager.login()`. | (a) call `frappe.sessions.generate_csrf_token()` in `LoginManager.login()` after `post_login()`; (b) keep minting lazily on the first HTML render only. | `Session.start()` already writes the session row exactly once through `insert_session_record()`, so the token is persisted in that same write with no extra database round trip, and it works under `frappe.in_test`, where `generate_csrf_token()` deliberately skips its session update. Every newly created logged-in session therefore holds a token, whichever entry point created it. | Sessions created by internal `login_as` callers (setup wizard, social login, user invitation, impersonation) also carry a token, so any caller that made an unsafe request on such a cookie session without the token would now be rejected. The framework has no such caller; `FrappeClient` is updated (RI-5). |
| RI-2 | Expose the token in the login response by setting `frappe.local.response["csrf_token"]` in `LoginManager.login()`, not in `set_user_info(resume=False)`. | (a) set it in `set_user_info(resume=False)`, which also covers `login_as` paths; (b) add a separate whitelisted endpoint that returns the token; (c) do not expose it and let clients read it from an HTML page. | `login()` is reached only for the `/api/method/login` path, so the token appears in exactly one response — the API login the directive names — and never in a resumed-session response or in the response of an internal `login_as`. Without exposure, fail-closed would lock out API clients, which is what the directive's "minting a CSRF token at API login" is for. | A site whose `allow_cors` names an origin lets that origin read the login response body, and therefore the token; that origin is already trusted to make credentialed cross-origin requests to the site. |
| RI-3 | Treat an explicit `allow_cors` origin (string or list) as a CSRF allow-list, but not `"*"`. | (a) remove the exemption for every `allow_cors` value; (b) keep `"*"` as an exemption (what D13 rejects). | An enumerated origin is a deliberate, bounded statement of trust — `set_cors_headers` already answers it with `Access-Control-Allow-Credentials: true` — so removing it would break configured integrations the reviewer did not ask to change. `"*"` names no origin at all and so cannot express trust in the origin that made a given request. | A cross-site scripting flaw on a listed origin can still drive an unsafe request on a token-less cookie session. Mitigated by RI-1: sessions created from now on hold a token and must supply it. |
| RI-4 | Validate CSRF only for an ambient cookie session, and never for the login request. `validate_csrf_token` returns early for `frappe.request.path == LOGIN_PATH` and for anything `is_cookie_session()` rejects (Guest, no `sid` cookie, or a session identified by an `sid` in the body/query — tracked by the new `Session.sid_from_request_parameter`). A cookie session that also carries an `Authorization` credential in a scheme `validate_auth` authenticates (`has_explicit_credential` over `EXPLICIT_AUTH_SCHEMES` = `basic`, `token`, `bearer`) is not ambient: `is_ambient_cookie_session()` is `is_cookie_session() and not has_explicit_credential()`, and a request it would otherwise reject has that rejection DEFERRED — `frappe.flags.deferred_csrf_rejection` is set, and `validate_deferred_csrf_rejection()`, the last statement of `validate_auth()`, drops it only when `frappe.flags.explicitly_authenticated_user` (recorded by `validate_oauth` and `validate_api_key_secret` when the credential verifies) equals `frappe.session.user`, and otherwise rejects with the same `frappe.CSRFTokenError`. A pending deferral is settled inside `frappe/app.py` `init_request`, which calls `validate_auth()` straight after `HTTPRequest()` and before the `before_request` hooks when `frappe.flags.deferred_csrf_rejection` is set; `validate_auth()` carries a `frappe.flags.auth_validated` guard so its usual call in `application()` is then a no-op. | (a) validate the login request too; (b) infer "not ambient" by comparing `frappe.session.sid` with the cookie `sid`; (c) drop the explicit-`sid` carve-out entirely; (d) exempt a cookie session as soon as an `Authorization` header is present, without waiting for it to authenticate; (e) move `validate_auth()` ahead of `HTTPRequest` in `frappe/app.py` so explicit authentication is known before CSRF runs; (f) drop the deferred rejection on any successful explicit authentication, whichever user it authenticated; (g) settle the deferral only where `validate_auth()` already ran, in `application()` after `init_request`; (h) settle it inside `validate_csrf_token` by calling `validate_auth()` there; (i) move the `validate_auth()` call ahead of the `before_request` hooks for every request. | A caller that presents an explicit credential had to know it, so the request cannot be a cross-site replay of a cookie the browser holds — which is why such a request is outside cookie CSRF once the credential is verified. (a) is impossible: `HTTPRequest` creates the session before validation runs, so the login request would be rejected by the token it just minted. (b) misclassifies a request that supplies the same `sid` explicitly and depends on cookie ordering. (c) would reject every `?sid=`/body-`sid` API request once tokens are minted, which interpretation I-2 keeps outside CSRF "as today"; the flag is recorded where the `sid` is read, because the value is popped from `form_dict` before validation can see it. (d) is unsafe: with a logged-in cookie `frappe.session.user` is not Guest, so `validate_auth`'s trailing `AuthenticationError` never fires for a forged `Authorization: Bearer junk`, and `set_cors_headers` reflects any `Origin` with `Access-Control-Allow-Credentials: true` and the requested headers while `allow_cors` is `"*"` — so a forged header would reinstate exactly the wildcard exemption RI-3 removes. (e) is impossible: `validate_api_key_secret` reads `frappe.local.login_manager`, which `HTTPRequest` creates, so authentication cannot precede it; deferring the decision instead keeps it ahead of every handler, since `validate_auth()` runs before any routing in `frappe/app.py`. (f) is unsafe: `validate_api_key_secret` does not call `frappe.set_user` when the cookie session is already logged in, so a valid key belonging to another user would exempt a request that still executes as the cookie's user. (g) leaves the rejection until after `init_request` has run every `before_request` hook — `frappe.recorder.record`, `frappe.monitor.start`, `frappe.rate_limiter.apply` and `frappe.integrations.oauth2.set_cors_for_privileged_requests`, plus anything an app adds — so a forged credential would reach arbitrary hook code as the ambient cookie user, which is not fail-closed. (h) would run `frappe.set_user` before `CookieManager.init_cookies()`, the last step of `HTTPRequest.__init__`, and an OAuth bearer request would then rewrite its own `sid` cookie to the user id. (i) changes the hook ordering for every request instead of only the credentialed cookie requests this decision is about. | An `Authorization` credential in a scheme only a site's own `auth_hooks` authenticate is not recognised, so such a request on a token-less cookie session is still rejected — fail-closed, and unchanged from the behaviour before this work. Any holder of a valid credential for the request's own user can make unsafe requests without a CSRF token, which is the trust that credential already carries. For a cookie request that carries a supported credential and no valid token, the `before_request` hooks now observe the authenticated user, and they do not run at all when the credential is rejected — matching the behaviour before this work, where the request never reached them. `validate_auth()` is idempotent from now on, so any future second caller silently gets a no-op. A caller that puts its `sid` in a URL stays outside the CSRF check; that exposure is pre-existing and unchanged by this work. |
| RI-5 | `FrappeClient` stores the login token in `self.headers["X-Frappe-CSRF-Token"]` (via `set_csrf_token`) and removes it on `logout()`. `test_client_sends_csrf_token_after_login` probes the stored header with an `insert`. | (a) pass the token as an argument on every request method; (b) add `csrf_token` to each request body; (c) probe the header in the test with a safe `get`, or by asserting only that `server.headers` holds it. | Every request method already forwards `headers=self.headers`, so one assignment covers `get`, `post`, `put` and `delete` without touching any call site, and a header works for form-encoded, JSON and file-upload bodies alike. A server that returns no `csrf_token` (older than this change) simply leaves the header unset, so the client keeps working against old servers. A client constructed with `api_key`/`api_secret` and no `username`/`password` never logs in and so never reaches `set_csrf_token`; one constructed with both does log in, and the stored token sits harmlessly beside the `Authorization` header it already sends. (c) would prove nothing: an `insert` is an unsafe request, which a cookie session accepts only with the token, so it is the probe that fails if the header is not honoured. | A caller that replaces `self.headers` wholesale after construction loses the token; callers that update it keep working. |
| RI-6 | Token-less scenarios in the tests strip the token from a real session instead of avoiding `login_as`. | (a) construct a `Session` object directly in the test; (b) hard-code a fabricated `sid`. | `login_as` now mints a token, so the faithful way to exercise a session created before the upgrade is to clear the stored token in both the `Sessions` row and the session cache — which is exactly how such a session looks on an upgraded site. The strip is confined to `TestCSRFProtection.token_less_sid`; `test_auth`'s unit-style cases synthesise the session dictionary directly. | The fixture depends on the session storage shape (the `sessiondata` JSON column and the `session` cache hash); a change to either must update it. |
| RI-7 | Two pre-existing `test_api` requests that relied on an ambient cookie session now authenticate explicitly: `test_delete_document_v1` passes `sid` in the query string, and `test_array_response_v1` (whose JSON array body cannot carry an `sid`) logs in through a test client of its own cookie jar (`FrappeAPITestCase.login_with_cookie_jar`, which never authenticates the shared `TEST_CLIENT`) and sends the returned token. | (a) relax the CSRF rule for the test client; (b) leave the two requests relying on the shared cookie jar. | Both requests passed only because a token-less session without browser headers was accepted — the behaviour the directive removes — and the shared jar's `sid` is whatever the previous test left behind. Stating the credential makes them deterministic and keeps the test aligned to the directive rather than the reverse. | None: the requests exercise the same endpoints with an explicit credential. |
| RI-8 | `TestLoginMintsCSRFToken` drives the whole login request in process rather than over HTTP: `set_request(path="/api/method/login", method="POST", base_url=get_site_url(...))`, a fresh `frappe.local.response`, a `form_dict` carrying `usr` and `pwd`, then `HTTPRequest()` — after which it asserts the token in every place that must agree, `frappe.session.data.csrf_token`, `frappe.local.response["csrf_token"]`, the `Sessions.sessiondata` JSON column read back through `frappe.qb`, and `frappe.sessions.get_csrf_token()`. Eight request-scoped `frappe.local` objects (request, session, session_obj, login_manager, cookie_manager, request_ip, response, form_dict) are captured and restored through `addCleanup`, and the session row it creates is deleted and evicted from the `session` cache hash. | (a) Exercise it over real HTTP through `FrappeAPITestCase`, as the other CSRF cases do; (b) call `LoginManager()` / `Session()` directly with no request; (c) mock the session layer and assert the calls made; (d) assert only the `csrf_token` field of the response and leave storage unchecked. | Three decisions meet on one request and only the real construction shows they hold together: RI-1 mints inside `Session.start()`'s single insert, RI-2 exposes the token only on the `/api/method/login` path, and RI-4 exempts that path from validation — so the test has to prove the login is not rejected by the token it has just minted. Over HTTP (a) the test can read the response body but not the server's `frappe.session` or the row inside the same transaction, so it cannot show that the returned token IS the stored one, which is the claim being made. (b) skips the CSRF validation `HTTPRequest` performs and so cannot show the exemption at all; (c) would assert the test's own doubles; (d) would leave RI-1's persistence unproven. | The case writes the process's request-scoped globals, so it is correct only while that restore list stays complete as `HTTPRequest` grows — a missed attribute leaks into whatever runs next in the same process. It is coupled to the session storage shape, the `sessiondata` JSON column and the `session` cache hash, the same coupling RI-6 carries. Its cleanup commits, so this case steps outside the harness's class-level rollback: a failure between the login and the cleanup can leave a session row behind. |
| RI-9 | Leave `frappe/app.py::set_cors_headers` exactly as it is, including the wildcard branch: when the effective `allow_cors` is `"*"` it reflects the request's own `Origin` into `Access-Control-Allow-Origin` and still sends `Access-Control-Allow-Credentials: true` with `Vary: Origin`. The CSRF tightening of RI-3 is made in `frappe/auth.py` alone. | (a) Stop sending `Access-Control-Allow-Credentials: true` when the configuration is `"*"`; (b) echo the literal `*` instead of the request origin; (c) drop wildcard support and require an enumerated list for any credentialed response; (d) reflect the origin only for safe methods. | The response-header contract is separate from the CSRF decision and is asserted by `frappe/tests/test_cors.py`, whose `allow_cors = "*"` case passes unchanged; D13 asked for the CSRF exemption to be removed, not for the CORS contract to change. With RI-3 in place `"*"` buys a request nothing at the CSRF layer, so this reflection no longer decides whether an unsafe request is accepted. (a) and (c) would break every integration a site deliberately opened up, on the strength of a configuration its operator chose. (b) is invalid: a credentialed response may not carry a literal `*`, so the configuration would simply stop working. (d) would change preflight semantics for that same deliberate configuration. | A site that keeps `allow_cors: "*"` still answers any origin with a credentialed CORS response, so any origin can read the body of a request the browser is willing to send with cookies. The protection now rests entirely on the CSRF token — which RI-1 mints for every session created from now on, and whose absence on an older session makes the unsafe request fail closed rather than pass. The operator guidance to enumerate origins is in §5 and is not enforced by code. |
| RI-10 | Leave the three discovery-related wildcards in `frappe/integrations/oauth2.py` untouched: `get_authorization_server_metadata` setting `frappe.local.allow_cors = "*"`, `set_cors_for_privileged_requests` setting it for `/.well-known/` on `GET` and `OPTIONS`, and that function's early return when `frappe.conf.allow_cors` is already `"*"`. | (a) Remove them, so discovery answers enumerated origins only; (b) replace the wildcard with the OAuth Settings origin list; (c) route them through `frappe.conf` so the CSRF path sees them too. | All three set `frappe.local.allow_cors`, and the CSRF check reads `frappe.conf.allow_cors` alone (`is_allowed_cors_origin`), so none of them ever exempted a request from CSRF and none does now — they are response-header scope, not authorization scope. The documents they serve are public by specification (RFC 8414 authorization-server metadata) and are fetched with safe methods, which is what a wildcard correctly expresses; (a) and (b) would break preflight for public OAuth clients, the entire purpose of the code, without taking any capability away from an attacker. (c) would newly couple a response-header decision to the CSRF decision, the opposite of the separation RI-3 and RI-4 rely on. | The `frappe.local` / `frappe.conf` split is what keeps these harmless, so any future code that copies `frappe.local.allow_cors` into the CSRF path — or a CSRF check that starts reading `frappe.local` — turns all three into exemptions silently. The early return also means a site already configured `"*"` gets no narrowing from this function; that is a no-op today, but it hides the wildcard from a reader of this function alone. |
| RI-11 | Leave `_set_allowed_cors` able to set `frappe.local.allow_cors = "*"` when an operator has entered `*` in OAuth Settings `allowed_public_client_origins`, and document the consequence in §5 instead of rejecting the value. | (a) Ignore `*` in that field and fall back to the enumerated lines; (b) validate the field so `*` cannot be saved; (c) keep `*` but withhold `Access-Control-Allow-Credentials` for those endpoints. | The endpoints it covers — dynamic client registration and the token, revocation, introspection and userinfo endpoints — authenticate with client credentials, a PKCE verifier or a bearer token rather than with the session cookie, so they are outside the CSRF check by design (`is_ambient_cookie_session`) and a wildcard there does not widen the cookie-session surface. (a) and (b) would change the validation behaviour of an existing settings field — product behaviour the directive did not ask to alter — and would break sites relying on a value they have already saved. (c) would edit the shared response layer for one caller's sake. What D13 requires of a retained `"*"` is that it be documented with its reason, which §5's table does. | Documented, not removed: an operator who enters `*` there lets any origin make credentialed cross-origin calls to those OAuth endpoints, and the narrower configuration — listing each public client's origin — is offered nowhere in the UI. The value is read through `frappe.get_cached_value`, so a correction takes effect only once the settings cache clears. |
| RJ-1 | Expose the baseline as four flat site-config keys (`x_frame_options`, `content_security_policy`, `x_content_type_options`, `referrer_policy`), treat an empty or null value as "omit this header", and add one boolean opt-out `disable_security_headers` | (a) A single nested `security_headers` dict keyed by header name; (b) both the dict and the flat keys; (c) no override surface at all, values fixed in code | Flat snake_case keys read and document like the site-config keys already governing response behaviour (`allow_cors`, `host_name`), and one mechanism means one precedence rule to reason about. Per-header omission plus a global opt-out covers every operator case (embedding, stricter policy, third-party assets, staged rollout) without a second syntax | An operator must know the exact key names; a typo silently leaves the default in place. A site that opts out loses all four headers rather than just the one it needed to relax |
| RJ-2 | `Referrer-Policy: strict-origin-when-cross-origin` | (a) `same-origin`; (b) `no-referrer`; (c) `strict-origin` | `frappe/auth.py` reads `Referer` as same-site evidence for token-less cookie sessions, and same-origin requests still send the full referrer under this value, so that evidence is unchanged. Cross-site requests send the origin only, which keeps the host check in `is_same_site_request` working while withholding paths and query strings. OAuth and payment redirects that leave the site still arrive with an origin, which providers that validate the referrer need — `same-origin` would strip it entirely and `no-referrer` would break both | Cross-origin recipients no longer see the full URL, so any integration that parses a path or query parameter out of `Referer` must be adapted. Matches the current Chrome/Firefox default, so the practical delta is small |
| RJ-3 | Default policy `default-src 'self'` with `script-src 'self' 'unsafe-inline' 'unsafe-eval' https:`, `style-src 'self' 'unsafe-inline' https:`, `img-src 'self' data: blob: https:`, `font-src 'self' data: https:`, `connect-src 'self' ws: wss: https:`, `frame-src 'self' blob: https:`, `media-src 'self' data: blob: https:`, `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, and migrate the one shipped path `object-src 'none'` blocks instead of relaxing the directive | (a) A nonce- or hash-based `script-src` with no `'unsafe-inline'`; (a2) relax `object-src` to `'self'` and keep the `<object><embed>` PDF preview; (a3) drop the File PDF preview; (a4) render it through a bundled JavaScript PDF viewer; (a5) omit `blob:` from `frame-src` and let the Print Format Builder preview fail; (b) report-only first; (c) a wildcard `default-src *` baseline; (d) `'self'`-only with no `https:` sources | Every source is required by shipped code: `frappe/www/desk.html` emits two inline `<script>` blocks (boot payload, CSRF token, translation fetch) and the analytics include, `frappe/public/js/frappe/dom.js::frappe.dom.eval` evaluates chart-source and print-format code, Desk markup carries inline `style` attributes, `phone.js`/`utils.js` load flag images from `flagcdn.com` and map tiles from OpenStreetMap/Stadia/ArcGIS, the file uploader renders `readAsDataURL` previews (`data:`) and PDF object URLs (`blob:`), `socketio_client.js` connects over `ws:`/`wss:`, and the print and attachment previews use same-origin iframes. `base-uri 'self'` and `frame-ancestors 'self'` add hardening no shipped code needs; `object-src 'none'` cost one shipped path, the File form's PDF preview, which rendered through `<object><embed type="application/pdf">` — the directive governs exactly those two elements, so the preview was migrated to a same-origin `<iframe>` (`frappe/core/doctype/file/file.js`) covered by `frame-src 'self'` rather than relaxing the directive, keeping the hardening and the preview. `frame-src` carries `blob:` because the Print Format Builder renders its preview from a `URL.createObjectURL(blob)` PDF in an iframe and `'self'` never matches a `blob:` URL. Nonces would require changing every template and bundle emitter — outside this refinement and explicitly guarded against by the directive's "do not break existing inline scripts/styles"; a wildcard baseline is what the directive forbids | `'unsafe-inline'` and `'unsafe-eval'` mean the policy does not stop script injection in the Desk; its value here is the framing, object, base-URI and scheme restrictions plus a documented, overridable starting point. Any `https:` origin remains reachable for assets and XHR, so exfiltration to an HTTPS endpoint is not prevented. A site loading assets over plain `http:` must override the policy. The migrated File preview shows the browser's built-in PDF viewer rather than a plugin's, so its toolbar differs slightly, and a client with no built-in viewer offers a download instead of an inline render; `frame-src blob:` lets a page frame any blob it can already create |
| RJ-4 | Send `X-Frame-Options: SAMEORIGIN` by default, but omit it only when the effective `Content-Security-Policy`'s `frame-ancestors` list holds a source that can match an origin other than the request's — a wildcard, a scheme-only source, a wildcard host, or a host source whose scheme, hostname or effective port differs from the request's; `'self'`, `'none'` and a host source spelling out the current origin keep the header | (a) Always send `SAMEORIGIN`; (b) `DENY` by default; (c) never send the header and rely on `frame-ancestors` alone; (d) treat every `frame-ancestors` source other than `'self'`/`'none'` as an outside origin | `X-Frame-Options` has no allow-list form, and browsers that still honour it apply it in preference to `frame-ancestors`, so sending `SAMEORIGIN` next to a Web Form's `frame-ancestors 'self' https://partner.example` would break exactly the embedding that form opted into. When `frame-ancestors` is absent, `'self'`-only, or names nothing but the current origin the two agree, so the header is kept for older browsers — (d) reads a redundant absolute spelling of the site's own origin as foreign and drops the legacy protection for nothing, which is why host sources are compared against the request's scheme, hostname and effective port (a missing port resolving to the scheme's default) instead of by token shape. `DENY` would break the framework's own same-origin iframes (print preview, attachment preview) | Legacy browsers that honour only `X-Frame-Options` place no framing restriction on a response that carries an embedding allow-list; those browsers were already unrestricted before this change. The comparison is textual against the request Frappe sees, so a site behind a proxy that rewrites the scheme or port without the forwarding headers `ProxyFix` reads can classify its own origin as foreign and omit the header |
| RJ-5 | Call `set_security_headers()` from `process_response()` after the CORS and `WWW-Authenticate` blocks and before `response.headers.update(frappe.local.response_headers)`, applying each header with `setdefault`, and decide `X-Frame-Options` from the *effective* policy that merge produces — the value in `frappe.local.response_headers` when that key is present, otherwise the one already on the response | (a) A WSGI middleware wrapping the application; (b) `before_request`/`after_request` hooks; (c) headers written in `frappe/website/utils.py::build_response` and the API layer separately; (d) `headers[...] = value` instead of `setdefault`; (e) read the policy off the response object only, as the first implementation did | `process_response` is the one place every dynamic response converges, including the exception branch, so one call covers Desk HTML, API JSON, downloads, well-known endpoints, `OPTIONS` and error pages. Running before the `response_headers` merge means an endpoint that deliberately sets one of the four still wins, and `setdefault` means a renderer that already wrote the header on the response (`web_form.py`) keeps it. Because that merge is last, the per-request policy is the one the client receives, so (e) mis-decides `X-Frame-Options` whenever the two layers disagree: it would add `SAMEORIGIN` beside a per-request policy that opts into external framing, and omit the header although the effective policy is `'self'`-only. A middleware would also wrap the static-file middleware, which the directive's response layer does not cover, and per-layer writes would drift | The headers are absent from responses that never reach `process_response` — static assets served by `SharedDataMiddleware` or nginx, which need their own configuration. Code that sets a header *after* `process_response` would override the baseline unnoticed, and the resolution reads only those two layers, so such a write is invisible to the `X-Frame-Options` decision |
| RJ-6 | Do not add a `form-action` directive | Add `form-action 'self'` | The login form, OAuth consent and payment integrations post to origins this refinement did not enumerate or exercise, and a wrong `form-action` silently breaks checkout and single-sign-on flows. The directive explicitly conditions this on verifying those flows | Form submissions to third-party origins remain unrestricted by CSP. A site that needs it can add the directive through `content_security_policy` |
| RJ-7 | When `DEV_SERVER=1`, allow the site's `<scheme>://<host>:<socketio_port>` origin for connections: append it to `connect-src` when the policy has one, otherwise append a `connect-src` synthesized from the policy's `default-src` sources plus that origin (dropping a `'none'` token), and leave a policy that restricts neither directive unchanged | (a) Add `http:` to `connect-src` for every site; (b) leave it out and let dev benches override the policy; (c) always append the socketio origin; (d) append only to an explicit `connect-src`, as the first implementation did; (e) synthesize a `connect-src` even when no directive restricts connections | The realtime client connects to `window.location.origin` behind a reverse proxy but to the separate socketio port when the development server serves the Desk, and socket.io's first transport is an XHR poll, which `connect-src` governs. Deriving the origin from the current request keeps production policies unchanged while `bench start` keeps working with no per-developer configuration. Fetch directives fall back to `default-src`, so (d) leaves realtime blocked on a dev bench whose site overrides `content_security_policy` with a restrictive `default-src` and no `connect-src` — which is the common shape of a hand-written policy — while (e) would newly restrict connections on a policy that governed none. Allowing `http:` globally would weaken every site for a development-only path | The dev-server branch is inert in production (`DEV_SERVER` unset), so it is exercised only on dev benches and by its unit tests. A bench that proxies socketio through a different host than the request host still needs an override. The synthesized directive freezes the `default-src` sources as they were at synthesis time, so a later edit of `default-src` alone no longer changes what connections are allowed on that dev bench |
| RJ-8 | Apply the baseline to every dynamic response, with no exemption for CORS-enabled sites, `OPTIONS` preflights or error responses | Skip cross-origin or preflight responses to avoid interfering with CORS | CORS and these headers answer different questions, and a site that sets `allow_cors: "*"` is the site that most needs the framing, sniffing and referrer protections. The error branch builds its response before `process_response`, so error pages are covered by the same call | A preflight response carries a policy header that browsers ignore for `OPTIONS`; harmless but visible in traces |
| RJ-9 | Cover the baseline in a new module `frappe/tests/test_security_headers.py` and one appended Cypress `it`, rather than extending `frappe/tests/test_cors.py` | (a) Add the cases to `test_cors.py`; (b) add them to `test_api.py`; (c) server-side tests only | `test_cors.py` is scoped to CORS reflection semantics and `test_api.py` to the REST surface; the header baseline spans both plus the website and Desk renderers, so a dedicated module keeps each suite's subject intact. The module reuses both existing harness patterns — `process_response` called directly for unit-level precedence cases, `FrappeAPITestCase` for real HTTP responses — and the Cypress case asserts the four headers on the dashboard response through `cy.request` and then loads the page to prove the Desk bundle still renders | One more test module to discover. The Cypress case runs only in the UI workflow, and it cannot observe the policy inside the browser: Cypress strips the `Content-Security-Policy` response header from the pages it loads unless `experimentalCspAllowList` is set in `cypress.config.js`, so a `securitypolicyviolation` assertion in a spec would be vacuous. Browser-level checks that the policy is enforced and that the two shipped PDF previews still load under it were therefore made in Chrome directly, and are recorded as evidence rather than as a committed assertion |
| RJ-10 | Create the Web Form fixture of `TestSecurityHeadersOnDesk` and delete it again with `frappe.db.commit()` on both calls, each carrying `# nosemgrep: frappe-manual-commit` | (a) Assert against a Web Form shipped with the app or already present on the site; (b) call `frappe/website/page_renderers/web_form.py` directly instead of making an HTTP request; (c) create the fixture once in a separate committed setup step outside the test module; (d) drop the web-form precedence case at HTTP level and keep only the unit-level one | The request is served by the WSGI application on its own database connection, which reads committed rows only, so a Web Form created inside the test transaction is invisible to it and the renderer answers 404 instead of the `frame-ancestors` policy the case exists to observe. No Web Form shipped with `frappe` declares Allowed Embedding Domains, so (a) has nothing to assert against and would bind the test to site data; (b) would bypass `process_response`, which is the subject of the module; (c) separates the fixture from the single test that needs it and leaves it on the site for good; (d) would leave the one precedence path a browser actually exercises uncovered | Both commits bypass the rollback `IntegrationTestCase` performs at class teardown, so they are real writes: an interruption between the insert and its `addCleanup` leaves a published Web Form named `test-security-headers-embed` on the site, and each `frappe.db.commit()` also flushes whatever else the same transaction held. The Semgrep pragmas must stay or the manual-commit rule fails the lint gate |
| RK-1 | `frappe/tests/test_oauth20.py`: the four authorization-code tests remove the `sid` cookie from the test client (`forget_sid_cookie`) after the authorize step and before posting to `frappe.integrations.oauth2.get_token` / `revoke_token`. | (a) Send the `login_as` session's token as `X-Frappe-CSRF-Token` on those posts; (b) exempt the OAuth token and revocation endpoints from `validate_csrf_token` in `frappe/auth.py`; (c) strip the token from the harness session as `TestCSRFProtection.token_less_sid` does and rely on same-site evidence. | The token and revocation endpoints are called by the OAuth client with its own credentials (client id / secret, PKCE verifier, bearer token), never by the resource owner's browser session, so a harness that carries the user's cookie into them models a request that does not occur in practice; dropping the cookie makes the tests exercise the bearer token alone. (a) and (c) keep the unrealistic ambient session; (b) widens the product's exemption list for a test-only need. | The module no longer covers an OAuth token request made from a logged-in browser session on the same origin; such a request needs the session's CSRF token, exactly like any other unsafe same-origin request. |
| RK-2 | `frappe/tests/test_api_v2.py`: `test_add_comment_v2` sends `sid` in its JSON body and `test_delete_document_non_existing_v2` sends it in the query string, instead of relying on the cookie that the v2 harness login leaves in the shared test client. | (a) Log in through the test client and send the CSRF token (as `test_array_response_v1` does); (b) strip the token from the harness session. | Mirrors RI-7 for the v1 tests and the rest of the v2 module, every other request of which already passes `sid`; an explicit credential is outside the CSRF check by design (`is_ambient_cookie_session`). | None beyond RI-7's: the two requests are no longer ambient cookie requests, which is the credential shape the v2 module already uses everywhere else. |
| RK-3 | The Rule 1 comment audit is a line-by-line read of every comment and docstring line the refinement adds, not a keyword grep. It found rationale in eleven files, listed here with the row that holds each WHY, and the disposition of every one of them is a WHAT-only rewrite of the passage with the reasoning left solely in that row. That rewrite is made in each case by the unit that owns the file, and every one of the eleven is in the tree this document describes: each passage now states what the code does and, where the reason is load-bearing, names the row that holds it; the §7 check reports the re-read of the merged tree. The eleven: `frappe/app.py` (the dev socketio CSP source → RJ-7), `frappe/auth.py` (the login exclusion, the ambient-credential forms, the wildcard rejection → RI-3, RI-4), `frappe/frappeclient.py` (the header against an older server → RI-5), `frappe/public/js/frappe/utils/utils.js` (the final-label stride → RA-3), `frappe/public/js/frappe/utils/dashboard_utils.js` (the `leaving_by_tab` flag → RD-5, initial option matching → RD-3, per-node binding → RD-8, the toggle-click close → RD-7), `frappe/public/js/frappe/widgets/chart_widget.js` (duplicate-error prevention, native-activation suppression, the modal-event choice, the focus destinations → RC-1, RC-3, RC-6, RD-2, RD-5), `frappe/public/scss/desk/desktop.scss` (the explicit placeholder selector → RF-3), `cypress/integration/todo_analytics_dashboard.js` (the debounced-resize wait → RA-4, animation polling → RE-9, hover-rule inspection → RG-4), `frappe/tests/test_api.py` (the explicit-credential and token-stripping fixtures → RI-6, RI-7), `frappe/tests/test_frappe_client.py` (the insert probe → RI-5), `frappe/tests/test_security_headers.py` (the module precedent and the manual commits → RJ-9, RJ-10). | (a) Keep the keyword grep of the added comment lines for `because`, `so that`, `in order to`, `rationale` and `why` as the audit and report its single hit as complete, which is what an earlier draft of this row did; (b) delete every added comment so no rationale can survive; (c) move each sentence into its row and leave no comment at all; (d) leave the rationale in the comments and cross-reference it from §6. | A keyword grep is unsound for this rule: it matches a phrasing rather than a property, so rationale written without those five words passes it — which is exactly what happened, as the exhaustive read found ten further files the grep had scored clean. Rule 1 makes the decision log the single source of truth for WHY, and O-7 requires comments in the edited framework files to state WHAT, so each passage has to be rewritten rather than merely cross-referenced, which rules out (d). A reader still needs to know what a flag, a guard or a fixture IS while reading it, so (b) and (c) would trade one defect for a less readable file; the pattern applied instead is a WHAT-only sentence plus, where the reason is load-bearing, a pointer to the row that holds it. | The audit is a human read, so its completeness is a judgement rather than a command's output: no automated check enforces this rule, and a comment added later can reintroduce rationale without tripping anything. A reader of any of the eleven files must open this document to learn why the code is shaped as it is, and the row pointers are what make that possible. With all eleven rewrites in place, Rule 1's ban on rationale in code comments is satisfied by the code as well as by this log; the property was confirmed on the merged tree, since each rewrite was made by the unit that owns the file and no single unit's branch could show it. |
| RK-4 | Row RD-4's regex `/38\|40\|27/` is written with escaped pipes so the row renders as five cells. | (a) Leave the raw regex unescaped, which split the row into seven cells; (b) drop the regex from the row and describe the key filter in prose; (c) render the whole decision log as a definition list instead of a table. | Rule 1 requires the decision log to be a table whose columns are the decision, the alternatives, the reason and the risks, and a row that breaks into seven cells loses that structure — the "Why this choice" and "Risks" text lands in the wrong columns. Escaping is the minimal fix and keeps the exact library value the decision turns on, which (b) would blur. | Any future row that quotes a pipe must escape it too; the check is a column count over the rendered table, which is part of Unit K's verification. |
| RK-5 | Cypress records the CSRF token `POST /api/method/login` returns in a module-level map keyed by the `cy.session` id, marks that key active after creation and restoration, and has `call`/`get_list`/`get_doc`/`insert_doc`/`update_doc`/`remove_doc` resolve it, synchronise it into `window.frappe.csrf_token` and fall back to the page token when none was recorded; `cy.call("logout")` clears it. | (a) A single "current token" variable; (b) force a token-injecting `cy.visit` inside `cy.login` or before every unsafe helper; (c) fetch the token from the server per helper call. | (a) breaks specs that alternate identities because `cy.session` does not re-run setup for a restored session; (b) adds a page load to every login and discards page state specs set up before writing; (c) spends a round trip per call on a value the login response already carries. | The map lives for the spec run, so a session destroyed outside `cy.call("logout")` would leave a token that no longer matches its `sid`; the key is the credential pair already written literally in the specs and stays in the Cypress process only. |

## 7. Test evidence

### Unit A — axis density and number formatting

- `pre-commit run --files frappe/public/js/frappe/utils/utils.js frappe/public/js/frappe/widgets/chart_widget.js cypress/integration/todo_analytics_dashboard.js` — every hook Passed (trailing whitespace, no-commit-to-branch, check-merge-conflict, prettier, eslint).
- `bench --site test_site run-tests --module frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed` — Ran 17 tests, OK.
- `bench --site test_site run-tests --module frappe.desk.dashboard_chart_source.todo_top_owners.test_todo_top_owners` — Ran 14 tests, OK.
- `bench --site test_site run-tests --module frappe.tests.test_todo_analytics_dashboard` — Ran 9 tests, OK.
- `bench --site test_site run-ui-tests frappe --headless --browser chrome --spec cypress/integration/todo_analytics_dashboard.js` — 2 passing, 0 failing: the existing `renders two cards and two charts` and the new `formats axis ticks consistently and keeps axis labels legible`.
- The same spec run against the unmodified `utils.js` and `chart_widget.js` fails the new case with `redundant decimals: expected '500.00' not to match /\.\d*0\b/`, and passes with them, so the new assertions cover the change rather than restating it.
- `bench --site test_site run-ui-tests frappe --headless --browser chrome --spec cypress/integration/dashboard_chart.js,cypress/integration/dashboard.js` — 1 passing each, as framework-chart regression.
- Runtime sweep of `/desk/dashboard-view/ToDo Analytics` (1640 seeded ToDos, trend peak 1250, five owners) at viewports 1400, 1024, 768 and 375 px, on a fresh load at each width and across five resizes of one rendered page: no two rendered x labels overlap or repeat on either chart, every y tick matches `^-?(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?( [A-Za-z]+)?$` with no duplicates, and the first tick stays `0`. Before the change the same sweep showed `09-20-2026` overlapping `09-21-2026` at 768 px, three identical `A ...` owner labels at 375 px and `500.00` beside `1 K` on both charts at every width.
- Axis ticks after the change: `0, 500, 1 K, 1.5 K, 2 K` on the trend chart and `0, 200, 400, 600, 800, 1 K` on Top Owners; the values over the bars print as `968, 185, 50, 24, 10`.
- `frappe.utils.format_chart_axis_number` exercised in the Desk console: `0` → `0`, `100` → `100`, `250` → `250`, `1250` → `1,250`, `0.30000000000000004` → `0.3`, `12345.678` → `12,345.68`, `2000` → `2 K`, `1500000` → `1.5 M`, `1250000` → `1.25 M`, `-1250` → `-1,250`, `100000` with country `India` → `1 L`, and `""`, `null`, `undefined`, `NaN` → the empty string.
- Other charts built through the shared helpers still render: the ToDo report-view chart shows `0, 500, 1 K, 1.5 K, 2 K` over the `Open` and `Closed` bars, and `frappe.utils.make_chart` probes at 700 px and 690 px produce the ratio the documented formula predicts with every x label rendered in full.
- No console error other than the site's pre-existing `socket.io` polling failures, and no failed request other than those, in any of the runs above.

### Unit B — time-window control lifecycle

Directives covered: D4 (a) re-render on every selection change, (b) no state leak between widget
instances, (c) restore focus to the triggering control; D10.2 automated coverage.

- **New automated coverage (D10.2)** — `cypress/integration/todo_analytics_dashboard.js` gains
  `it("re-renders the trend chart on every time-window change and keeps focus on the control")`; the
  pre-existing `it("renders two cards and two charts")` is unchanged. It intercepts the trend chart
  source, asserts one request per selection carrying the selected `timespan`/`time_interval`, asserts the
  `.x.axis text` count grows for `Last Month` (≥ 28 daily labels) and shrinks for `Weekly`, asserts both
  `.filter-label`s, asserts `cy.focused()` is the toggle of the dropdown just used, asserts the
  `ToDo Top Owners` widget has no `.timespan-filter` and an unchanged SVG, and restores the window with
  the chart menu's `Reset Chart` (labels back to 8, `Last Week`/`Daily`).
- `run-ui-tests frappe --headless --browser chrome --spec cypress/integration/todo_analytics_dashboard.js`
  → `2 passing`, all specs passed (repeated three times, including after the final build).
- Regression specs: `--spec cypress/integration/dashboard_chart.js` → `1 passing`;
  `--spec cypress/integration/dashboard.js` → `1 passing`.
- Python regression (unchanged by this unit, re-run as the no-regression gate):
  `run-tests --module frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed`
  → `Ran 17 tests … OK`; `… todo_top_owners.test_todo_top_owners` → `Ran 14 tests … OK`;
  `… frappe.tests.test_todo_analytics_dashboard` → `Ran 9 tests … OK` (40 tests).
- Static checks:
  `pre-commit run --files frappe/public/js/frappe/widgets/chart_widget.js frappe/public/js/frappe/utils/dashboard_utils.js cypress/integration/todo_analytics_dashboard.js`
  → every hook `Passed`; `build --app frappe` → exit 0.
- **Runtime verification in Chrome** on a two-widget probe dashboard and on `ToDo Analytics`, driving each
  control by mouse and by keyboard: ten selections produced exactly one data request each, carrying
  `Last Month`/`Daily`, `Last Month`/`Weekly`, `Last Month`/`Weekly` (identical repeat, 85 DOM mutations in
  the chart wrapper), `Last Quarter`/`Weekly` (keyboard only), `Last Week`/`Daily` (`Reset Chart`),
  `Select Date Range` `2026-09-04`→`2026-09-13`, then `Last Month`/`Daily` and `Last Week`/`Daily` on
  `ToDo Analytics`. The `.x.axis text` count tracked the window (8 → 32 → 6 → 6 → 14 → 8 → 10, and
  10 → 32 → 8). `document.activeElement` after every selection was that dropdown's own
  `[data-toggle="dropdown"]` inside the operated widget, the `.chart-menu` toggle after `Refresh`/`Reset
  Chart`, and the date input for `Select Date Range` — both immediately and after the redraw. The sibling
  widget issued no request, mutated no DOM node, kept its own `.filter-label`s and kept a byte-identical
  `svg.frappe-chart`. Two widgets showing the same chart held independent windows and reset independently.
  Every `/api/method/` response was 200 and no JavaScript exception was raised.

### Unit C — error-state recovery

- **Cypress** `cypress/integration/todo_analytics_dashboard.js` — new case
  `it("recovers from a chart data error with the retry affordance")`, appended beside the existing case, which
  is unchanged. It forces one HTTP 500 on the trend chart's data call with `cy.intercept`, then asserts: the
  error container is visible and carries the server's message, the message node has `role="alert"`, exactly one
  `button.chart-retry` is visible, the widget has no chart SVG, and the Top Owners widget is never in error;
  a mouse click on Retry restores the chart; a second forced failure (driven through the widget's own
  ⋯ → Refresh action) re-renders the error state with still exactly one Retry control; `keydown` Enter on the
  focused Retry button restores the chart again; focus then sits on `button.chart-menu`; and a window marker
  set before the first retry is still intact, proving no page reload.
  Result: `2 passing` / "All specs passed!" (verified on two consecutive headless Chrome runs).
- **Regression** — `cypress/integration/dashboard_chart.js` 1 passing, `cypress/integration/dashboard.js`
  1 passing; Python `test_todo_created_vs_completed` 17 OK, `test_todo_top_owners` 14 OK,
  `test_todo_analytics_dashboard` 9 OK.
- **Runtime QA in headless Chrome** (a deliberately broken runtime Dashboard Chart, since the HTTP 508 case is
  not deterministically reproducible and its cause is out of scope): before the change the chart hung on
  "Loading…" with an empty, hidden error container and a `TypeError` in the console, and the ⋯ → Refresh action
  changed nothing. After the change the error container shows the server message with a Retry button; the chart
  call sequence over a single page load was 403 → 200 (keyboard Enter on Retry) → 403 (⋯ → Refresh after
  re-breaking the chart) → 200 (mouse click on Retry), each success hiding the error and rendering
  `svg.frappe-chart` with eight daily labels, with the page's navigation-entry count unchanged at 1 and the
  in-page marker intact throughout — no reload. The Retry button is reached in 8 Tab presses and paints a
  visible 2 px focus ring.
- **Static checks** — `pre-commit run --files frappe/public/js/frappe/widgets/chart_widget.js
  frappe/public/scss/desk/desktop.scss cypress/integration/todo_analytics_dashboard.js`: every hook Passed;
  `bench build --app frappe` clean.

### Unit D — keyboard and ARIA menus

- **New and existing Cypress assertions** —
  `bench --site test_site run-ui-tests frappe --headless --browser chrome --spec cypress/integration/todo_analytics_dashboard.js,cypress/integration/dashboard_chart.js,cypress/integration/dashboard.js`
  → exit 0, 4 passing: `todo_analytics_dashboard.js` "renders two cards and two charts" (the original block,
  2925 ms) and "widget menus are keyboard operable, mark the selected option and restore focus" (the new
  block, 724 ms); `dashboard_chart.js` "Check filter populate for child table doctype";
  `dashboard.js` "should load". The new block drives the timespan menu (open, ArrowDown, Escape, focus
  back on the control), selects "Last Month" from the keyboard and asserts that it becomes the only
  `aria-checked="true"` option and that the control's label follows, restores "Last Week", repeats the
  open/Escape/focus cycle on the time-interval menu with `aria-checked` on "Daily", walks the chart
  actions menu with ArrowDown and End and closes it with Escape, opens and closes the first Number Card's
  actions menu with Enter and Escape, asserts `aria-haspopup="dialog"` on both "Set Filters" buttons, and
  asserts that every widget menu's `aria-labelledby` resolves to an element.
- **No regression in the feature's Python suite** —
  `run-tests --module frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed`
  → Ran 17 tests, OK; `… todo_top_owners.test_todo_top_owners` → Ran 14 tests, OK;
  `… frappe.tests.test_todo_analytics_dashboard` → Ran 9 tests, OK (40 of 40).
- **Static checks** — `pre-commit run --files frappe/public/js/frappe/utils/dashboard_utils.js
  frappe/public/js/frappe/widgets/chart_widget.js frappe/public/js/frappe/widgets/number_card_widget.js
  cypress/integration/todo_analytics_dashboard.js` → every hook Passed (trailing whitespace, merge
  conflicts, prettier, eslint). `bench build --app frappe` completes with no error.
- **Runtime verification in headless Chrome, with real key events, before and after the change** — every
  widget menu on `/desk/dashboard-view/ToDo Analytics` was driven through the full cycle (open with Enter,
  Space and ArrowDown, move with ArrowDown, ArrowUp, Home and End including the wrap at both ends,
  activate, close with Escape, close with Tab, close by clicking outside) with `document.activeElement`,
  `aria-expanded` and the menu's `show` state recorded after every key press. Before the change the audit
  recorded that opening a menu never moved focus into it, that there was no wrapping and no Home or End,
  and that a click outside dropped focus on `body`; after the change all four menus pass every step, and
  activating "Refresh" leaves focus on the rebuilt chart actions control. The same cycles pass on the
  Users workspace (one chart widget and three Number Card tiles) and on a heatmap chart's year dropdown,
  and the Build workspace remains keyboard navigable, which shows the shared helper did not disturb
  workspace widgets. No console error, warning or unhandled rejection was produced by any interaction.

### Unit E — keyboard tooltips

- `cypress/integration/todo_analytics_dashboard.js` — new case `it("plot-area tooltips are reachable from the
  keyboard")`: for each chart widget it asserts the focusable plot area (`role` and `aria-label` non-empty),
  focuses it, then asserts that <kbd>→</kbd> shows `.graph-svg-tip` at opacity `1` with text containing
  "Created"/"Completed" (trend) or "Open ToDos" (owners), that the `aria-live="polite"` node contains the
  tooltip title and value, that a second <kbd>→</kbd> changes the data point, that <kbd>Home</kbd> returns to
  the first and <kbd>End</kbd> jumps to (and clamps on) the last, and that <kbd>Esc</kbd> hides the tooltip and
  clears the live region. It then re-checks that <kbd>↓</kbd> still opens the chart menu and that the bar
  `mousemove` tooltip still appears. Result: `✓ renders two cards and two charts` and
  `✓ plot-area tooltips are reachable from the keyboard` — 2 passing, 0 failing; `dashboard_chart.js` and
  `dashboard.js` also pass unchanged.
- Python suites unaffected by the change and re-run as a regression gate:
  `frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed` 17 tests OK,
  `frappe.desk.dashboard_chart_source.todo_top_owners.test_todo_top_owners` 14 tests OK,
  `frappe.tests.test_todo_analytics_dashboard` 9 tests OK.
- Runtime verification in headless Chrome on `/desk/dashboard-view/ToDo Analytics`: <kbd>Tab</kbd> reaches the
  plot area of both widgets (it was unreachable before the change); on the trend chart <kbd>→</kbd> ×3 walked
  09-14-2026 → 09-15-2026 → 09-16-2026, <kbd>Home</kbd> returned to 09-14-2026 and <kbd>End</kbd> showed
  09-21-2026 with "Created 4, Completed 0"; on the owners chart <kbd>→</kbd> walked Administrator (3) →
  Frappe (1) and clamped there; the live region matched the tooltip on every move; <kbd>Esc</kbd> and blur
  returned the tooltip to opacity `0` and emptied the live region; the chart menu still opened with
  <kbd>↓</kbd>; <kbd>Tab</kbd> from the plot area moved focus on; the same sequence worked at a 375px
  viewport; no console error other than the environment's pre-existing `/socket.io/` 404s.
- Static checks: `pre-commit run --files frappe/public/js/frappe/widgets/chart_widget.js
  cypress/integration/todo_analytics_dashboard.js` — every hook Passed; `bench build --app frappe` succeeded.

### Unit F — WCAG contrast

Measured with a WCAG 2.1 helper (sRGB linearisation, `rgba()` composited over the element's
effective background, ratio `(L1+0.05)/(L2+0.05)`) against computed styles read from the
running Desk at `/desk/dashboard-view/ToDo Analytics`, light theme and dark theme.

| Surface | Requirement | Light before | Light after | Dark before | Dark after |
| --- | --- | --- | --- | --- | --- |
| Focus ring vs `--card-bg` | 3:1 | **1.566** | 7.814 | **1.640** | 6.293 |
| Focus ring vs `--control-bg` | 3:1 | **1.429** | 7.042 | **1.408** | 5.106 |
| Chart placeholder / no-data text (`.chart-loading-state.text-extra-muted`) | 4.5:1 | **3.930** | 7.358 | **3.840** | 5.785 |
| Date-range input `::placeholder` | 4.5:1 | **2.568** | 7.042 | **1.448** | 5.106 |
| Chart error text (`.chart-loading-state.text-danger`) | 4.5:1 | **4.163** | 6.309 | **3.729** | 6.321 |
| Breadcrumb link (`.navbar-breadcrumbs a`) | 4.5:1 | **4.174** | 7.814 | **4.177** | 6.293 |
| Breadcrumb `/` separator (`a::before`) | 3:1 | **2.849** | 4.174 | 4.177 | 4.177 |
| `.widget-title` | 4.5:1 | 17.928 | 17.928 | 12.701 | 12.701 |
| `.widget-subtitle`, number-card body | 4.5:1 | 7.814 | 7.814 | 6.293 | 6.293 |
| `.number-widget-box .number` | 4.5:1 | 17.928 | 17.928 | 12.701 | 12.701 |

The four bold light-theme figures 1.566, 3.930, 4.163 and 4.174 reproduce the review's
1.56, 3.93, 4.16 and 4.17 to the measured precision. The 3.93:1 "placeholder text" was
traced to `.text-extra-muted` on `--subtle-accent`, the chart widget's placeholder state,
rather than to an input placeholder; the input placeholder was measured separately and was
worse, at 2.568:1.

**Focus ring observed, not inferred.** All five widget controls — `.chart-menu`,
`.filter-chart`, the timespan toggle, the interval toggle and the number-card actions toggle
— report `:focus-visible` matching with `box-shadow: rgb(82, 82, 82) 0 0 0 2px` in light and
`rgb(153, 153, 153) 0 0 0 3px` in dark. The ring was pixel-sampled in the saved screenshots
as exactly `rgb(82, 82, 82)` at about 2px on all four edges of the focused control (light)
and `rgb(153, 153, 153)` at about 3px (dark), with the unfocused second widget's button
showing no ring. `button.filter-chart` previously had no focus indicator at all in either
theme, because `.dashboard-widget-box .btn-xs { box-shadow: none }` outranks
`global.scss .btn:focus-visible`; the scoped `:focus-visible` rule restores it.

**No regression on other pages.** `/desk/todo` (list) and `/desk/todo/new` (form) were
measured before and after: all twelve compared values are identical — the seven tokens, both
breadcrumb sets, every named input placeholder, the focused primary, page-head and menu
buttons, and a `.text-danger` probe. A `.text-extra-muted` probe still resolves to
`--ink-gray-5` on both pages, confirming the scoped `!important` does not leak. Neither page
contains a `.widget`, `.widget-group`, `.dashboard-page` or `.dashboard-widget-box` element,
and neither `body` matches `[data-route^="dashboard-view"]`. Deleting all eight injected rules
from the live CSSOM and re-measuring produced an identical result on both views, and the form
view is pixel-identical to its pre-change capture (0 of 3,910,965 pixels differ).

**Automated coverage.** `cypress/integration/todo_analytics_dashboard.js` gains one `it`,
"dashboard text and controls meet WCAG AA contrast", which computes the ratios in-test from
computed styles and asserts breadcrumbs, the date-range placeholder, the error text, the
no-data text and the widget and card tile text at 4.5:1, and the focus ring at 3:1 against
both the widget and the control background. It restores the timespan to "Last Week" and
re-hides both `.chart-loading-state` nodes, leaving Dashboard Settings as found. The existing
`it` is unchanged — the diff is 207 insertions and 0 deletions.

| Command | Result |
| --- | --- |
| `run-ui-tests --spec cypress/integration/todo_analytics_dashboard.js` | 2 passing, 0 failing |
| `run-ui-tests --spec cypress/integration/dashboard.js` | 1 passing, 0 failing |
| `run-tests --module frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed` | Ran 17 tests, OK |
| `run-tests --module frappe.desk.dashboard_chart_source.todo_top_owners.test_todo_top_owners` | Ran 14 tests, OK |
| `run-tests --module frappe.tests.test_todo_analytics_dashboard` | Ran 9 tests, OK |
| `pre-commit run --files frappe/public/scss/desk/desktop.scss cypress/integration/todo_analytics_dashboard.js` | All hooks Passed |
| `bench build --app frappe` | Exit 0, no warnings |

Screenshots, under `blitzy/screenshots/` (evidence only, not committed):
`unitF_before_light.png`, `unitF_before_dark.png`, `unitF_after_light.png`,
`unitF_after_dark.png` (both after shots with a focused control's ring painted),
`unitF_after_light_ringzoom.png`, `unitF_after_dark_ringzoom.png`,
`unitF_before_list.png`, `unitF_before_form.png`, `unitF_after_list.png`,
`unitF_after_form.png`.

### Unit G — tile hover affordance

- **New Cypress case.** `cypress/integration/todo_analytics_dashboard.js` →
  `it("number card tiles expose a hover and focus affordance")`: asserts both tiles carry the
  `widget-shadow` class, `tabindex="0"`, `role="link"` and a non-empty `aria-label`; asserts a CSS `:hover`
  rule for the tile is loaded by scanning `document.styleSheets` for a selector matching
  `/number-widget-box[^,{]*:hover|widget-shadow:hover/` (a synthetic mouse event cannot trigger CSS
  `:hover`, so the hover path is covered by rule presence); focuses the first tile and asserts its computed
  `box-shadow` and `border-color` both differ from the unfocused baseline; presses Enter on the focused tile
  and asserts the route becomes `/desk/todo` with the list view rendered.
- **Spec run.** `bench --site test_site run-ui-tests frappe --headless --browser chrome --spec
  "cypress/integration/todo_analytics_dashboard.js,cypress/integration/dashboard.js"` → 3 passing, 0
  failing: "renders two cards and two charts" (the pre-existing case, unchanged), "number card tiles expose
  a hover and focus affordance" (new), and `dashboard.js` "should load".
- **Python regression (D2).** `frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed`
  17 tests OK, `…todo_top_owners.test_todo_top_owners` 14 tests OK,
  `frappe.tests.test_todo_analytics_dashboard` 9 tests OK — 40/40 unchanged.
- **Runtime verification in Chrome** on `/desk/dashboard-view/ToDo Analytics` at 1440x900, with a real mouse
  pointer and real key presses:
  - Idle tile: `box-shadow: none`, `border-color: rgb(237, 237, 237)`.
  - Hovered: `box-shadow` becomes the three-layer `var(--shadow-base)` elevation and `border-color` becomes
    `rgb(82, 82, 82)`; a pixel diff of the tile region shows 5,357 changed pixels (max channel delta 155)
    extending beyond the border box where the new shadow paints, while the neighbouring tile changes by 134
    antialiasing pixels only. Values revert when the pointer leaves.
  - Keyboard: the tile itself becomes `document.activeElement` at Tab press 4 (before the change it never
    received focus in 30 presses), matches `:focus-visible`, and paints a leading
    `rgba(201, 201, 201, 0.898) 0 0 0 2px` ring ahead of the elevation layers with `outline-width: 0`.
  - Activation: Enter and Space both navigate to `/desk/todo?status=Open` with the ToDo list rendered and
    the card's `status = Open` filter applied; Space is `preventDefault()`ed, and on a deliberately
    scrollable viewport the scroll container stayed at `scrollTop: 0` while a control press of Space on the
    body moved it to 347.
  - Non-regression: the nested "Card Actions" trigger still takes focus and Enter still opens its dropdown
    (`aria-expanded` flips to `true`, items "Refresh" and "Edit") without navigating away.
  - Screenshots: `blitzy/screenshots/unitG_before.png` (baseline), `unitG_hover.png`, `unitG_focus.png`,
    `unitG_enter_todo_list.png`, plus the shortcut-tile reference captures
    `unitG_shortcut_reference.png` and `unitG_shortcut_focus.png`.
- **Static checks.** `pre-commit run --files frappe/public/js/frappe/widgets/number_card_widget.js
  frappe/public/scss/desk/desktop.scss cypress/integration/todo_analytics_dashboard.js` — every hook
  Passed; `bench build --app frappe` exit 0 with the new rules present in the compiled `desk.bundle.css`.

### Unit H — empty filter write

Environment: bench 7 (`/opt/frappe-bench-7`), site `test_site`, web port 8170, assets rebuilt with
`bench build --app frappe`.

**Runtime reproduction (before).** Runtime records "Empty Filter Probe" (Dashboard Chart, `chart_type`
Count on `ToDo.creation`) and "Empty Filter Card Probe" (Number Card, Count on ToDo), both with
`filters_json = [["ToDo","status","=","Open",false]]` and
`dynamic_filters_json = [["ToDo","allocated_to","=","frappe.defaults.get_user_default(\"no_such_default_key\")",false]]`,
were placed on a runtime Dashboard "Empty Filter Probe" with three Open ToDos seeded. Loading the
dashboard in Chrome, both requests carried
`filters = [["ToDo","status","=","Open",false],["ToDo","allocated_to","=",null,false]]`;
`number_card.get_result` returned `0.0` and `dashboard_chart.get` returned
`values: [0,0,0,0,0,0,0,0]`. The card tile rendered `0` and the chart was a flat zero line, with no
console error — the failure was silent. `frappe.client.get_count` for the same ToDo filters returned
`3` for the static filter alone and `0` for the list actually sent.

**Runtime verification (after).** With the fix built into the Desk bundle, the same dashboard sent
`filters = [["ToDo","status","=","Open",false]]` on both endpoints — the `allocated_to` row is absent —
`number_card.get_result` returned `3.0`, `dashboard_chart.get` returned
`values: [0,0,0,0,0,0,0,3.0]`, the tile rendered `3` and the chart showed the seeded count. In-page
checks: `typeof frappe.dashboard_utils.is_unset_filter_value === "function"`; list-shaped call →
`[["ToDo","status","=","Open",false],["ToDo","priority","=","High",false]]`; dict-shaped call →
`{"status":"Open","priority":"High"}` with no `allocated_to` key at all; `0` case →
`[["ToDo","idx","=",0,false]]`. No "Invalid expression set in filter" message appeared, and the only
console output was the pre-existing socket.io polling 404s (no socket.io process in this environment)
and the pre-existing `"" is not a valid color` chart warning. The probe records were deleted afterwards.

**Cypress.** `cypress/integration/todo_analytics_dashboard.js` — `2 passing`
(`renders two cards and two charts`, unchanged, and the new
`does not write empty dynamic filter values into the widget filter state`). Reverting
`dashboard_utils.js` to its pre-refine state and rebuilding makes only the new case fail
(`expected [ Array(5) ] to deeply equal [ Array(2) ]`), so the case genuinely guards the fix.
`cypress/integration/dashboard_chart.js` — `1 passing`. `cypress/integration/dashboard.js` — `1 passing`.

**Python (D2 regression).** `frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed`
— 17 tests, OK. `frappe.desk.dashboard_chart_source.todo_top_owners.test_todo_top_owners` — 14 tests, OK.
`frappe.tests.test_todo_analytics_dashboard` — 9 tests, OK.

**Static checks.** `pre-commit run --files frappe/public/js/frappe/utils/dashboard_utils.js
cypress/integration/todo_analytics_dashboard.js` — every applicable hook Passed (prettier, eslint on
the utility file; eslint skips `cypress/*` by repository configuration).

### Unit I — CSRF and CORS

Verified on bench `frappe-bench-8`, site `test_site`, MariaDB 11.8.5, with the site served at
`http://test_site:8180` (`host_name` matches).

Python test modules, before and after the change (all `OK`):

| Module | Before | After |
| --- | --- | --- |
| `frappe.tests.test_auth` | 3 unit + 29 integration | 3 unit + 32 integration |
| `frappe.tests.test_api` | 43 | 47 |
| `frappe.tests.test_frappe_client` | 13 | 14 |
| `frappe.tests.test_cors` | 4 | 4 (unchanged) |

CSRF-related tests: the 24 that existed are retained (`TestCSRFTokenValidation` 17,
`TestCSRFProtection` 5, `TestHostname` 2), three of them updated to the directive's values
(`test_auth::test_request_without_browser_origin_rejected_when_session_has_no_token` — renamed from
`..._allowed_...`; the `"*"` case of `test_auth::test_allow_cors_conf_allows_cross_site_request_without_token`;
`test_api::test_request_without_browser_origin_is_rejected` — renamed from `..._is_accepted`), plus
`test_auth::test_supplied_token_is_removed_from_the_form_dict`, which now asserts the rejection and the
form-dict pop together. Eight tests are new: `test_token_less_session_requires_positive_same_site_evidence`,
`test_sid_in_form_dict_without_cookie_is_not_subject_to_csrf`,
`TestLoginMintsCSRFToken::test_api_login_mints_stores_and_returns_a_csrf_token`,
`test_allow_cors_wildcard_does_not_exempt_token_less_session`, `test_login_response_carries_csrf_token`,
`test_token_from_login_is_accepted_on_cookie_session`,
`test_login_token_session_rejects_unsafe_request_without_token`, and
`test_frappe_client::test_client_sends_csrf_token_after_login`.

Runtime transcript (`curl` against the running site; a "token-less" session is a logged-in session whose
stored `csrf_token` was cleared):

| Request | Result |
| --- | --- |
| `POST /api/method/login` | 200, JSON carries `csrf_token`, equal to the token stored in the session's `Sessions` row and to `frappe.csrf_token` on `GET /desk` |
| `POST /api/resource/ToDo`, cookie session with a token, no header | 400 `CSRFTokenError` |
| the same with `X-Frappe-CSRF-Token` | 200, document created |
| token-less cookie session, no `Origin`/`Referer`/`Sec-Fetch-Site` | 400 `CSRFTokenError` (accepted before this change) |
| token-less, `Sec-Fetch-Site: same-origin` only | 200 |
| token-less, `Origin` or `Referer` host of the site | 200 |
| token-less, `Origin: http://evil.example` | 400 `CSRFTokenError` |
| token-less, `Sec-Fetch-Site: cross-site` with a matching `Origin` | 400 `CSRFTokenError` |
| `allow_cors: "*"`, token-less, cross-origin or header-less | 400 `CSRFTokenError` (accepted before this change) |
| `allow_cors: ["http://partner.example"]`, token-less, `Origin: http://partner.example` | 200 (RI-3) |
| explicit `sid` in the body, with and without a stale cookie, foreign `Origin` | 200 (outside CSRF, unchanged) |
| safe `GET` with the cookie and a foreign `Origin`; Guest `POST` | 200 (unchanged) |

Browser evidence (headless Chrome 153 through `run-ui-tests`): `cypress/integration/login.js` 6 passing
(form logins and `cy.call("logout")`, which is an unsafe cookie-session `POST` carrying the Desk token);
`cypress/integration/todo_analytics_dashboard.js` 1 passing (`cy.insert_doc` writes with
`frappe.csrf_token` from the Desk boot); and a temporary spec, run and then removed, in which a form
login yielded a non-empty `window.frappe.csrf_token`, `frappe.xcall("frappe.client.insert")` created a
ToDo, and `/desk/dashboard-view/ToDo Analytics` rendered both cards and both charts with the error state
not visible.

Regression suites: `test_todo_created_vs_completed` 17 `OK`, `test_todo_top_owners` 14 `OK`,
`test_todo_analytics_dashboard` 9 `OK`. Static checks: `python -m compileall` clean and `pre-commit run
--files` all hooks `Passed` for `frappe/auth.py`, `frappe/sessions.py`, `frappe/frappeclient.py`,
`frappe/tests/test_auth.py`, `frappe/tests/test_api.py` and `frappe/tests/test_frappe_client.py`.

### Unit J — security headers

**Headers observed** (`curl -sI` against a live bench, site `test_site`, port 8190):

| Request | Result |
| --- | --- |
| `GET /desk` (Administrator `sid` cookie) | `200 text/html` + `X-Frame-Options: SAMEORIGIN`, full default CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| `GET /api/method/ping` | `200` + all four headers |
| `GET /login` (Guest) | `200` + all four headers |
| `GET /this-route-does-not-exist` | `404` + all four headers |
| `OPTIONS /api/method/ping` | `200` + all four headers |
| `GET /<web form with allowed embedding domains>/new` | `200` + `Content-Security-Policy: frame-ancestors 'self' https://embed.example`, **no** `X-Frame-Options`, `nosniff` and `Referrer-Policy` still applied |

Before the change, none of the four headers was present on any of these responses.

**Browser check** — headless Chrome over the Desk surfaces, authenticated, with the policy live: `/desk/dashboard-view/ToDo Analytics`, `/desk/todo`, `/desk/todo/new`, `/desk/todo/view/report`, `/desk/user-profile`, `/desk/build`, `/desk/print/ToDo/<name>`, `/printview?doctype=ToDo&name=<name>`, `/login`, `/update-profile` and a web form with allowed embedding domains. **Zero** `Refused to …` / Content-Security-Policy violation messages on every page. Both dashboard charts render (2 × `svg.frappe-chart`), the timespan dropdown opens and re-renders both charts on selection, the chart menu opens, the dark theme keeps both charts rendering, the file uploader shows its `data:` image preview, the print-preview iframe renders, and the report view renders its datatable and chart dialog. The only console errors are the pre-existing socket.io `404`s of a bench with no realtime service, identical to the pre-change baseline.

**Automated tests**

| Suite | Result |
| --- | --- |
| `frappe.tests.test_security_headers` | 19 tests, OK (14 response-layer, 5 over HTTP) |
| `frappe.tests.test_cors` | 4 tests, OK (unchanged) |
| `frappe.tests.test_api` | 43 tests, OK |
| `frappe.tests.test_auth` | 29 tests, OK |
| `…todo_created_vs_completed.test_todo_created_vs_completed` | 17 tests, OK |
| `…todo_top_owners.test_todo_top_owners` | 14 tests, OK |
| `frappe.tests.test_todo_analytics_dashboard` | 9 tests, OK |
| `cypress/integration/todo_analytics_dashboard.js` | 2 passing, including the new header + intact-bundle case |
| `cypress/integration/dashboard.js` | 1 passing |
| `cypress/integration/form.js` | 5 passing (uploads, dialogs and child tables under the policy) |

`pre-commit run --files frappe/app.py frappe/tests/test_security_headers.py cypress/integration/todo_analytics_dashboard.js` — all hooks Passed; `python -m compileall -q -f` clean on both Python files.

### Whole-tree verification

Run on one bench against the complete change set (all units together), site `test_site`, web server on port 8200 started with `CI=true`; assets rebuilt with `build --app frappe`, `migrate` run (`Updating Dashboard for frappe`).

- `python -m compileall -q -f` over `frappe/app.py`, `frappe/auth.py`, `frappe/sessions.py`, `frappe/frappeclient.py` and the changed test modules — clean.
- `pre-commit run --files <every changed file>` — trailing whitespace, merge-conflict, python ast, debug statements, ruff import sorter / linter / formatter, prettier and eslint all Passed.
- Python modules, each `OK`: `test_todo_created_vs_completed` 17, `test_todo_top_owners` 14, `frappe.tests.test_todo_analytics_dashboard` 9 (the 40 D2 protects), `frappe.tests.test_security_headers` 19, `frappe.tests.test_cors` 4, `frappe.tests.test_frappe_client` 14, `frappe.tests.test_auth` 3 + 32, `frappe.tests.test_api` 47, `frappe.tests.test_oauth20` 8, `frappe.tests.test_api_v2` 44.
- `run-ui-tests frappe --headless --browser chrome --spec cypress/integration/todo_analytics_dashboard.js` — **10 passing, 0 failing** (the original case plus the nine cases added for D3–D9 and D12); `cypress/integration/dashboard.js` 1 passing; `cypress/integration/dashboard_chart.js` 1 passing. `package.json` and `yarn.lock` unchanged afterwards.
- `run-tests --app frappe` (whole framework suite on the merged tree, 2374 tests, 21 min): every failure was classified. All 68 are environmental on this host or test-order database state and fail identically without this change set — no RQ workers (`frappe.core.doctype.rq_job`, `rq_worker`, `prepared_report`, `submission_queue`, `bulk_update`, `test_background_jobs`, `test_recorder`, `test_delete_orphaned_doctypes`), no SMTP service (`frappe.email.*`, `frappe.tests.test_email`, `test_export_report_via_email`, `user_invitation`), the bench CLI refusing to run as root (`frappe.commands.test_commands`), a hypothesis health check (`test_utils.test_get_datetime`), and test-order database state (`test_docshare.test_list_permission`, `test_report`, `test_auto_repeat.test_submit_on_creation`, `test_query.test_drop_unique_constraint_for_deleted_fields_mariadb`, `test_user.test_reset_password`). The last two are the suite's own leftovers: earlier tests leave `Website Settings.home_page` pointing at a test Web Page and grant `test@example.com` the `Website Manager` role; restoring those two values makes `test_docshare` (15/15) and `test_user` (16/16) pass on this tree, and `git diff` shows `frappe/core/doctype/user`, `docshare`, `frappe/website`, `frappe/www` and `frappe/rate_limiter.py` untouched. `test_oauth20` (8/8) and `test_api_v2` (44/44), whose harness requests were updated per RK-1 / RK-2, pass inside the whole-suite run.
- Headless Chrome on `/desk/dashboard-view/ToDo Analytics` (Administrator): two charts and two tiles render; console carries only the `/socket.io` 404s of a bench without a realtime service — zero other errors, zero `Refused to` CSP violations, zero `TypeError`. Selecting "Last Month" from the timespan menu re-fetched and redrew the trend chart (8 → 32 x labels), returned focus to the timespan toggle and left exactly one `aria-checked="true"` option ("Last Month"); the plot area took keyboard focus and ArrowRight / ArrowRight / End moved the tooltip (`opacity: 1`) with the live region reading "08-21-2026: Created 0, Completed 0" … "09-21-2026: Created 15, Completed 0", and Escape hid it; the first Number Card tile focused as `role="link"` "ToDo Total Open: open list" with the `rgb(82, 82, 82)` 2 px focus ring; "Reset Chart" restored "Last Week" / "Daily" and 8 labels; the dashboard HTML response carried `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and the Desk-tuned `Content-Security-Policy`.

### Unit K — merged-tree regression

Run on a bench provisioned from the merged tree (clone index 20, `/opt/frappe-bench-20`, database
`test_frappe_20`, site `test_site`, web server on port 8300): `migrate` printed
`Syncing dashboards... / Updating Dashboard for frappe`, `build --app frappe` completed in 3.9 s, the
setup wizard was completed and the UI test user created. The HTTP-level modules and the Cypress specs
ran against that server; it was started with `CI=true` because `frappe.tests.ui_test_helpers` is gated
on `frappe.in_test`, a dev server with `allow_tests`, or the `CI` variable, and `form.js` /
`list_view.js` otherwise fail in their `before all` hooks with HTTP 417 from
`create_contact_records` / `setup_workflow`.

**Scope verification (D1).**

| Check | Command | Result |
| --- | --- | --- |
| Every changed path classified | `git diff --name-status a8824d994f..HEAD` | 43 paths = 12 Section C + 18 feature files + the 13 rows of §3 (one of them the unchanged Project Guide); nothing unclassified |
| Chart data caching / telemetry untouched | `git diff a8824d994f..HEAD -- frappe/utils/dashboard.py frappe/desk/doctype/dashboard_chart/dashboard_chart.py` | empty |
| Chart sources' caching untouched | `git diff 932cb6aae4..HEAD -- frappe/desk/dashboard_chart_source` | empty (no `cache_source`, `no_cache`, `chart-data` or `last_synced` line anywhere in the refinement's diff of that tree) |
| Dependency advisories and CI gates untouched | `git diff a8824d994f..HEAD -- pyproject.toml package.json yarn.lock .github frappe/patches.txt frappe/hooks.py` | empty |
| Decision-log / test-inventory reconciliation not attempted | `git diff 932cb6aae4..HEAD -- "blitzy/documentation/Project Guide.md"` | empty (the file was added by `932cb6aae4`, the pre-refinement delivery) |
| Rationale kept out of code comments (Rule 1, O-7) | line-by-line read of every comment and docstring line the refinement adds; the keyword grep (`because`, `so that`, `in order to`, `rationale`, `why`) was kept only as a first pass | Pass on the merged tree. Full read: the eleven files RK-3 inventories carried rationale, and the WHAT-only rewrite of each is in this tree — every flagged sentence is gone (a literal search for each returns nothing) and every added comment or docstring line was re-read after the units' changes were combined. The keyword grep over the added comment lines is clean as well, but it is the first pass only, not the evidence |
| Decision log well-formed (Rule 1) | column count over every §6 row | 87 rows, five filled columns each, after escaping every pipe quoted inside a cell — the regexes in RD-4, RE-9, RG-4 and the one RK-4 quotes back (RK-4) |

**Extend rather than replace (D2).** Test and `it` names were diffed between `932cb6aae4` and `HEAD`:

| File | Before → after | Removed |
| --- | --- | --- |
| `cypress/integration/todo_analytics_dashboard.js` | 1 → 10 `it` blocks | none; the original "renders two cards and two charts" still runs |
| `frappe/tests/test_auth.py` | 32 → 52 methods (+ classes `TestLoginMintsCSRFToken` and `TestExplicitCredentialCSRF`) | `test_request_without_browser_origin_allowed_when_session_has_no_token`, renamed with a flipped expectation to `test_request_without_browser_origin_rejected_when_session_has_no_token` (O-5); the `"*"` subtest of `test_allow_cors_conf_allows_cross_site_request_without_token` moved to the rejection case (RI-3) and `test_supplied_token_is_removed_from_the_form_dict` now expects rejection without same-site evidence |
| `frappe/tests/test_api.py` | 44 → 48 methods | `test_request_without_browser_origin_is_accepted`, renamed with a flipped expectation to `test_request_without_browser_origin_is_rejected` (O-5) |
| `frappe/tests/test_frappe_client.py` | 13 → 14 methods | none |
| `frappe/tests/test_api_v2.py`, `frappe/tests/test_oauth20.py` | 44 → 44, 8 → 8 | none; only the two credential changes of RK-1 and RK-2 |
| `frappe/desk/doctype/number_card/test_number_card.py`, `…/test_dashboard_chart_source.py` | 5 → 5, 7 → 7 | none; unchanged by this refinement |

**Python regression (D2).** `fbench-20 --site test_site run-tests --module <module>`, every module `OK`:

| Module | Result |
| --- | --- |
| `frappe.desk.dashboard_chart_source.todo_created_vs_completed.test_todo_created_vs_completed` | Ran 17 tests in 1.190s — OK |
| `frappe.desk.dashboard_chart_source.todo_top_owners.test_todo_top_owners` | Ran 14 tests in 0.158s — OK |
| `frappe.tests.test_todo_analytics_dashboard` | Ran 9 tests in 0.114s — OK (17 + 14 + 9 = the 40 D2 protects) |
| `frappe.tests.test_auth` | Ran 3 tests in 0.075s — OK, then Ran 49 tests in 7.539s — OK (the explicit-credential matrix and the `before_request` ordering case of RI-4 included) |
| `frappe.tests.test_api` | Ran 47 tests in 2.280s — OK (isolated CSRF fixtures: own session, own cookie jar, exact `allow_cors` restore) |
| `frappe.tests.test_cors` | Ran 4 tests in 0.003s — OK |
| `frappe.tests.test_frappe_client` | Ran 14 tests in 1.479s — OK |
| `frappe.tests.test_security_headers` | Ran 29 tests in 0.516s — OK (`blob:` frames, effective-policy precedence, origin-aware `frame-ancestors`, `default-src` socket fallback, the `file.js` preview guard) |
| `frappe.tests.test_api_v2` | Ran 44 tests in 10.122s — OK |
| `frappe.tests.test_oauth20` | Ran 8 tests in 1.013s — OK |
| `frappe.tests.test_website` | Ran 24 tests in 1.231s — OK |
| `frappe.website.doctype.web_form.test_web_form` | Ran 36 tests in 1.641s — OK (the `frame-ancestors` precedence path of RJ-4) |
| `frappe.tests.test_hooks` | Ran 5 tests — OK, then Ran 11 tests in 0.426s — OK (`before_request` dispatch after the RI-4 ordering change) |
| `frappe.tests.test_perf` | Ran 21 tests in 5.621s — OK |
| `frappe.tests.test_query` | Ran 59 tests in 19.510s — OK (skipped=3) |
| `frappe.tests.test_db_query` | Ran 65 tests in 12.306s — OK (Dashboard Settings permission query) |
| `frappe.desk.doctype.number_card.test_number_card` | Ran 5 tests in 0.311s — OK |
| `frappe.desk.doctype.dashboard_chart_source.test_dashboard_chart_source` | Ran 7 tests in 0.249s — OK |
| `frappe.desk.doctype.dashboard_chart.test_dashboard_chart` | Ran 11 tests in 0.607s — OK |
| `frappe.desk.doctype.dashboard.test_dashboard` | Ran 1 test in 0.352s — OK |
| `frappe.desk.doctype.todo.test_todo` | Ran 6 tests in 0.922s — OK |

462 Python tests in total. `frappe/desk/doctype/dashboard_settings` ships no test module; the row lock
`save_chart_config` now takes (RB-4) is exercised end to end by the time-window Cypress case, whose
fixture dashboard drives three chart widgets saving into one `chart_config`.

**Cypress (D2).** `fbench-20 --site test_site run-ui-tests frappe --headless --browser chrome --spec <spec>`:

- `cypress/integration/todo_analytics_dashboard.js` — **10 passing, 0 failing**, "All specs passed!":
  renders two cards and two charts; formats axis ticks consistently and keeps axis labels legible;
  re-renders the trend chart on every time-window change and keeps focus on the control; recovers from a
  chart data error with the retry affordance; widget menus are keyboard operable, mark the selected
  option and restore focus; plot-area tooltips are reachable from the keyboard; dashboard text and
  controls meet WCAG AA contrast; number card tiles expose a hover and focus affordance; does not write
  empty dynamic filter values into the widget filter state; serves the dashboard with the security
  response headers and an intact bundle.
  Run twice in a row on the same site: 10/10 both times, and afterwards no `Cypress%` Dashboard, Dashboard
  Chart or Number Card row remained and this user's Dashboard Settings held the value the spec found
  (the `before`/`beforeEach`/`afterEach` hooks of F-F03).
- `cypress/integration/dashboard_links.js` — 4 passing, its first case writing through `cy.insert_doc`
  straight after `cy.login` with no page load (RK-5). `cypress/integration/dashboard.js` — 1 passing.
  `cypress/integration/dashboard_chart.js` — 1 passing. `cypress/integration/number_card.js` — 1 passing.
  `cypress/integration/login.js` — 6 passing. `cypress/integration/form.js` — 5 passing.
- `cypress/integration/list_view.js` — 6 of 7 passing. The one failure is the realtime-dependent
  `enables "Actions" button` case ("Not enough elements found. Found '7', expected '9'"), which fails on
  this host because no socket.io service runs; it is unrelated to this refinement and is the documented
  known failure of the environment.
- `package.json` and `yarn.lock` are byte-identical after every run.

**Static checks.** `python -m compileall -q -f frappe` — clean, exit 0. `pre-commit run --files` over
every changed file outside `blitzy/` — trailing whitespace, no-commit-to-branch, merge conflict, python
ast, check json, debug statements, ruff import sorter, ruff linter, ruff formatter, prettier and eslint
all Passed.

**Two artefacts of running the whole set on one site**, both environmental and both cleared before the
final sweep was repeated, neither caused by this change set: running `cypress/integration/list_view.js`
calls `frappe.tests.ui_test_helpers.setup_workflow`, which leaves an active `Test ToDo` Workflow with
email alerts on the site, after which any module that inserts a ToDo outside a request context fails in
`send_workflow_action_email` (`AttributeError: 'NoneType' object has no attribute 'environ'` from the
website router) — deleting that Workflow restored `test_api` to 47 OK; and the repeated runs exhausted
the site's own hourly rate limit for `frappe.www.login.login_via_key`, so
`test_auth.test_login_with_email_link` returned 429 instead of 200 — clearing that one per-site counter
restored `test_auth` to 3 + 32 OK. The final confirmation run after both was `todo_analytics_dashboard.js`
10/10, `dashboard.js` 1/1 and `dashboard_chart.js` 1/1 in one invocation ("All specs passed!", 12 of 12).

**Runtime verification** on `http://test_site:8300/desk/dashboard-view/ToDo Analytics` as
Administrator, in the headless Chrome the UI runner drives:

- Two `.number-widget-box` tiles ("ToDo Total Open", "ToDo Total Closed") and two
  `.dashboard-widget-box` charts, each with `svg.frappe-chart`; the error and loading containers are
  present but not visible.
- The dashboard document's own response carries `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a
  `Content-Security-Policy` containing `frame-ancestors 'self'` and `object-src 'none'`.
- Selecting "Last Month" from the timespan menu re-fetched and redrew the trend chart (8 → more x
  labels), moved the label to "Last Month", returned focus to the timespan toggle and left exactly one
  `role="menuitemradio"` with `aria-checked="true"`; restoring "Last Week" returned the axis to 8 labels.
- Focusing the trend chart's `.chart-plot-area[tabindex="0"][role]` and pressing ArrowRight showed
  `.graph-svg-tip` at opacity 1 and filled `.chart-tooltip-announcer[aria-live]`; Escape hid it.
- The first Number Card tile is `tabindex="0"`, `role="link"` and carries an `aria-label`.
- Zero Content-Security-Policy violations (captured through a `securitypolicyviolation` listener) and no
  console errors other than the `/socket.io` 404s of a bench without a realtime service.
- With a forced HTTP 508 on the trend source, the error state became visible with
  `button.chart-retry` labelled "Retry loading ToDo Created vs Completed"; activating it hid the error
  and re-rendered the chart.
- The trend chart's y axis was dumped around a timespan switch to check D3's no-duplicate requirement
  against a screenshot that appeared to show two `10` ticks: while `frappe-charts` animates the axis the
  previous maximum tick is still in the DOM, and once the transition settles the axis reads
  `0, 2.5, 5, 7.5, 10` — distinct and correctly formatted. The apparent duplicate is a transient frame
  of the library's own transition, not a formatting defect.
