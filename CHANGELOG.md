# Changelog

## 0.9.1

Hotfix: a recording could come out with no `goto` in it.

- **Resuming a recording never recorded where it resumed.** The opening
  navigation was added only to a session with no steps yet — so the ordinary
  workflow of stop, walk to another page, start again produced a script whose
  second half ran against whatever page the first half had ended on. The test is
  now "is the flow already on this page", read from the last step's own URL,
  rather than "is this session new". A goto added mid-flow is commented
  `Recording resumed on this page` so it does not read like a mistake.
- **A tab that was still loading recorded no opening URL at all.** Chrome leaves
  `tab.url` empty until the navigation commits and holds the destination in
  `tab.pendingUrl`; only the first was read. Pressing record while the page comes
  up is normal, and it produced a recording that started nowhere.
- **The panel now names the page it is pointed at**, under the test-case title.
  On a page Chrome blocks extensions from — `chrome://`, the Web Store, a PDF —
  it says so and disables the record button, instead of recording nothing and
  explaining nothing.

## 0.9.0

- **Fixed: scrolling a container was never recorded.** The recorder measured
  every scroll against `window.scrollY`. On a page that scrolls a `div` under a
  fixed header — which is half of them — the events arrived, the offset never
  moved, and the whole burst was discarded as too small to matter. Each scroll
  step now measures the element that actually scrolled and records which one it
  was; the load-more loop and the positional step target that element rather than
  the window. Reproduced in a browser against a real scrolling container before
  and after.
- **Fixed: a scroll over unnameable content recorded nothing.** On an image grid,
  a map or a chart there is no element in view worth a locator, and the step was
  silently dropped — so the script went on to click something the page had not
  lazily rendered. Those scrolls are now recorded as `scrollPosition`, a pixel
  offset carrying a note saying why. A visibly poor step beats a missing one.
- **Fixed: a scroll right after a click was suppressed.** Scrolling within 700ms
  of a recorded action is ignored because clicks and navigations scroll the page
  themselves — but that also ate the tester's own scroll. A wheel or touch gesture
  now overrides the suppression: the page can scroll itself, but it cannot fake
  the gesture.
- **Editing a recorded test case.** ✎ on any step opens an editor: insert an
  assertion after it (element assertions reuse that step's locator and iframe),
  change a value or a note, reorder with ↑ / ↓. Steps renumber by position. A
  password or variable step still refuses a typed-in value, enforced in the store
  rather than only in the UI.
- Two `scrollToBottom` steps in one Playwright/TypeScript flow declared
  `previousHeight` twice in the same scope. The loop is now block-scoped.

## 0.8.0

- **Infinite scroll.** A scroll that settles near the bottom is checked 900ms
  later for whether the document grew; if it did, the step is a `scrollToBottom`
  rather than an element scroll. Consecutive rounds collapse into one step with a
  repeat count. The generated code is a loop bounded by that count but ended by
  the page height going stable, since the same list loads a different amount on a
  different day. Cypress repeats the recorded count instead, its command queue
  not being imperative.

## 0.7.0

- **More keys.** `ArrowLeft/Right`, `Home`, `End`, `PageUp/Down`, `Backspace`,
  `Delete`, and every modifier combination (`Control+A`, `Control+Shift+K`).
  Navigation and editing keys are recorded only outside a text field, where the
  fill step does not already describe the same edit. Cypress gets `{ctrl}a` with
  the letter lowercased — an uppercase letter there implies Shift — and Selenium
  gets an ActionChains key_down/key_up pair.
- **Typing shows up live.** A field being typed into produces one step that is
  replaced as the value grows, instead of nothing until focus leaves the field.
- **Masked fields are detected.** When the characters typed do not match the
  field's final value, the step is marked to be typed key by key and carries the
  raw keystrokes — Playwright emits `pressSequentially`, because `fill()` assigns
  the value and a masked field never sees it.
- **Scrolling is recorded**, as an intent rather than an offset: a burst becomes
  one `scrollIntoViewIfNeeded()` on the element that ended up in view. Movement
  under 60px, scrolling caused by a recorded action, and scrolling with nothing
  nameable in view are all ignored.

## 0.6.0

- **New format: Playwright (Python).** The synchronous `run(playwright)` shape that
  `playwright codegen --target python` produces, so a recording drops straight into
  an existing Python suite. snake_case methods, `name=` keyword arguments, `.first`
  as a property rather than a call, and `import os` / `expect` only when the body
  uses them. Several test cases become one `run_<name>` function each, with a
  non-ASCII title preserved as the docstring.

## 0.5.0

- **BASE_URL.** Define a variable of that name and recorded navigations under it
  are generated relative to it — `process.env.BASE_URL + "/login"` — so one test
  runs against staging and production rather than being copied per environment.
  URLs on another host stay absolute, and matching respects path boundaries so
  `https://app.test` does not swallow `https://app.testing.com`. Resolved at
  generation time, so defining it after recording works.

## 0.4.2

- **Fixed: generated scripts had no opening navigation.** Recording captured a
  navigation only when a page loaded *while* recording, so starting a recording on
  an already-open page — the normal way to work — produced a script with no
  `page.goto` / `cy.visit` / `driver.get`. The test began on a blank page and
  failed on its first action. Start recording now records the tab's current URL as
  step one.
- Recordings saved before this fix still lack that step; their generated script
  now opens with a `FIXME` naming the page it was recorded on instead of failing
  with no explanation.

## 0.4.1

- **Download .env** in the Script tab: writes the environment file the generated
  script needs, with the right variable names already in place — `.env`, or
  `cypress.env.json` when the Cypress format is selected. Non-secret values are
  filled in and secret values are deliberately left blank with a comment, so a
  password does not travel in a downloaded file.

## 0.4.0

- **New assertion: "Assert this text appears on the page."** Binds to the text
  rather than to an element, so a success message moving from an `<h2>` to a
  `<div>` no longer fails a test that is checking nothing about the markup.
  Select a phrase first to assert exactly that phrase. Emits
  `getByText(...).first()` for Playwright, `cy.contains(...)` for Cypress, and an
  XPath over text nodes for Selenium.

## 0.3.2

- New icon: a pointer with a record dot, anti-aliased and composed per size — the
  full cursor at 32 px and above, a reshaped variant at 16 px whose tail still
  lands on whole pixels. The generator lives in `tools/make-icons.mjs`.
- Added `PRIVACY.md`, needed for a Chrome Web Store listing, and
  `STORE-LISTING.md` with the submission copy and permission justifications.

## 0.3.1

- Renamed to **QA Test Case Recorder** — the extensions page, the toolbar tooltip and the side
  panel header now all say the same thing.

## 0.3.0

- **Test data (variables)** — Tools → Test data defines the values scenarios
  reuse, such as a fixed test phone number and password. While recording, a field
  filled with a matching value stores the **variable's name instead of the
  literal**, so nothing downstream carries the credential: Playwright emits
  `process.env.TEST_PHONE`, Cypress `Cypress.env(...)`, Selenium `os.environ[...]`,
  and the spreadsheet and YAML exports show `${TEST_PHONE}`. Generated scripts
  open with the list of variables they need.

  A password field is the one place the recorder reads a password at all: the
  contents are compared against known secrets in memory and only the name is
  stored. Secret values are never written into an export or a library file.

- **Zephyr Scale export** — `Zephyr Scale (CSV)` and `Zephyr Scale (Excel)` in the
  shape Zephyr's test-case importer expects. Assertions are folded into the
  preceding action's Expected Result, because Zephyr models a step as one triple
  (do this / with this data / expect that) while a recording keeps the assertion
  as a step of its own. The opening navigation becomes the Precondition, and
  locators are omitted — this is the human test case, not the automation artefact.

## 0.2.0

- **YAML export** — a readable, diff-friendly `Test cases (YAML)` format, with
  each step's element, iframe chain, and `value` / `expected`. Export only; the
  importable round-trip format is still the library JSON.

## 0.1.0

First build shared with the team.

- **Recorder** — clicks, double-clicks, typing, select changes, checkbox/radio
  toggles, meaningful keys and navigation, each captured with a robust XPath, an
  absolute XPath, a text XPath, a CSS selector and the element's visible name.
  Locators deliberately avoid framework-generated ids such as `:r3:` or
  `css-1a2b3c`, which change every build.
- **Assertions** — right-click any element mid-recording: text, field value,
  visible, hidden, page URL.
- **Bug detection** — console errors and warnings, uncaught errors, unhandled
  rejections, `fetch` / XHR failures, 4xx/5xx responses and failed resources.
  Always collecting, not only while recording, and each issue is linked to the
  step it followed.
- **iframes** — recorded in every frame, including cross-origin, with the frame
  chain stored as locators for the `<iframe>` elements themselves.
- **Script generation** — Playwright, Cypress, Selenium (Python), with a Smart /
  XPath-only / CSS-only locator strategy.
- **Test-case library** — save recordings, cap 500, with export and import of a
  `qa-library.json` for backup and team sharing. Import merges and never
  overwrites.
- **Spreadsheet export** — CSV (UTF-8 BOM, so Excel reads non-Latin text) and
  `.xlsx` with a Steps sheet and an Issues sheet, frozen headers and autofilter.
- **Passwords are never captured.** The step is flagged and generated scripts read
  `TEST_PASSWORD` from the environment.
