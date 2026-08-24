# QA Plugin — Test Recorder

A Chrome extension for QA work: record test cases capturing **XPath and the
element's visible name**, generate **automation scripts**, and **detect bugs** as
they happen.

## Running it

```bash
npm run dev
```

WXT 0.21 no longer launches a browser itself, so load the extension once by hand:
`chrome://extensions` → enable Developer mode → **Load unpacked** →
`dist/chrome-mv3-dev`. After that every code change hot-reloads.

For a production build:

```bash
npm run build
```

…then load `dist/chrome-mv3` the same way. Click the toolbar icon to open the
side panel.

The output directory is `dist/`, not WXT's default `.output/` — a dot-prefixed
directory is hidden in Finder and in Chrome's folder picker, which makes
installing needlessly hard every time.

## Architecture

| Part | Where it runs | Why there |
|---|---|---|
| `entrypoints/probe.content.ts` | content script, **MAIN world** | The only place the page's own `console` and `fetch` are visible. A normal content script lives in an isolated world and sees neither. |
| `entrypoints/recorder.content.ts` | content script, isolated world | Captures events in the capture phase and bridges probe findings to the background. Stays alive as long as the page does, unlike a service worker. |
| `entrypoints/background.ts` | service worker | The only writer to storage. Chrome tears it down after ~30s idle, so it keeps no state in memory. |
| `entrypoints/sidepanel/` | side panel | The UI. Unlike a popup, it does not close when you click the page. |
| `lib/selector-engine/` | shared | Locator generation. The heart of the project. |
| `lib/codegen/` | shared | Playwright / Cypress / Selenium-Python / Markdown / JSON. |
| `lib/library.ts` | shared | Saved test cases. |

### Two decisions worth knowing about

**1. Generated locators do not rely on framework-invented identifiers.**
`lib/selector-engine/stable.ts` rejects ids and classes like `:r3:` (React
`useId`), `css-1a2b3c` (emotion) and CSS-modules hashes. These change on every
render or every build, so a test built on them passes once and then fails in CI
for no visible reason. A longer structural path is emitted instead.

**2. Every detected bug is linked to the step that preceded it**
(`Issue.nearStepId`). That is the difference between "there is an error in the
console" and "clicking Save is broken".

## What gets recorded

Clicks, double-clicks (a pending click is held for 220ms so a double-click can
replace it rather than producing three steps), typing, select changes,
checkbox/radio toggles, meaningful keys (Enter/Escape/Tab/arrows) and navigation.

**Password fields are never captured.** The step is flagged `sensitive` and the
generated script reads `TEST_PASSWORD` from the environment — so a recorded login
flow can be committed to a repository without leaking a credential.

## Test data (variables)

A login scenario needs a phone number and a password, and a team reuses one fixed
pair across every scenario. Baking those into each recording means the literal
ends up in every generated script and every exported sheet, and changing the test
account means editing all of them.

**Tools → Test data** defines them once: a name in environment-variable form
(`TEST_PHONE`), a value, and a `secret` flag. While recording, a field filled with
a value matching one of these stores the **variable's name instead of the
literal** — so nothing downstream ever sees it:

| Output | What appears |
|---|---|
| Playwright | `fill(process.env.TEST_PHONE ?? "")` |
| Cypress | `type(Cypress.env("TEST_PHONE"))` |
| Selenium | `send_keys(os.environ["TEST_PHONE"])` |
| Markdown / CSV / Excel | `${TEST_PHONE}` |
| YAML | `variable: TEST_PHONE`, with no `value` key |

Generated scripts open with the list of variables they need, and the Script tab
shows the same list above the code, so nobody discovers a missing value one failed
run at a time.

### The password case

A password field is the one place the recorder reads a password at all. The
contents are compared against the known secrets **in memory**, and what gets
stored is a variable name — never the text. A password that matches nothing is
recorded as `sensitive` with no value, exactly as before, and generated code falls
back to `TEST_PASSWORD`.

Matching is exact and longest-value-first, so a variable whose value is a prefix
of another's does not shadow the more specific one.

### Two things to be clear about

Variable values live unencrypted in `chrome.storage.local`, like a `.env` file on
disk. That is appropriate for a shared test account and for nothing else.

Secret values are **never written into an export or a library file** — only names
travel. So `qa-library.json` stays safe to commit, and a teammate who imports it
supplies their own values.

## Assertions

Mid-recording, **right-click** any element → "QA — add assertion":

| Menu entry | Playwright output |
|---|---|
| Assert this element's text | `expect(loc).toHaveText(...)`, or `toContainText` past 60 characters |
| Assert this field's value | `expect(loc).toHaveValue(...)` |
| Assert this element is visible | `expect(loc).toBeVisible()` |
| Assert this element is hidden | `expect(loc).toBeHidden()` |
| Assert the page URL | `expect(page).toHaveURL(...)` |

Each assertion is an ordinary step: deletable, annotatable, and placed in the
script exactly where it was recorded. The panel marks them green with a ✓.

Long text switches to `contains` automatically because equality on a long
sentence breaks on any incidental whitespace or copy edit, and that failure
points at no real bug.

For text assertions the element is exactly what was right-clicked. For visibility
and value assertions it resolves up to the nearest interactive ancestor — when
you right-click the label inside a button, you meant the button.

## Test-case library

The **Library** tab stores the current recording via "Save current recording".
Saved cases live in `chrome.storage` (capped at 100) as full snapshots, so each
one can be exported to any format later — not only the format selected when it
was saved.

### Backup and team sharing

`chrome.storage.local` is per-Chrome-profile and local. Every teammate has their
own isolated library, and uninstalling the extension erases it — so the library
alone is not somewhere test cases can safely live.

**Export library file** writes the whole library as one pretty-printed
`qa-library.json`, meant to be committed to the repo or dropped in a shared
folder. **Import library file** reads it back. That is the only format that
round-trips: a "Raw session (JSON)" export is a different shape and is rejected
with a message saying so.

Import **merges and never overwrites**. An incoming test case either matches
something already present or becomes a new entry:

| Situation | Result |
|---|---|
| Identical content already present | skipped — re-importing a file is a no-op |
| Same id, content diverged | kept as a separate entry, titled "… (imported)" |
| New | added, keeping its id so a later re-import stays idempotent |
| Would exceed 500 cases | skipped **and reported** |

Matching is by content fingerprint (title plus each step's action, XPath and
value), not by id — two people recording the same flow produce different ids, so
id-only matching would import the same case twice.

Overwriting was deliberately left out: a teammate's file would then silently
replace work that is not in it.

`chrome.storage.sync` was considered and rejected — its quota is 102 KB total and
8 KB per item, and a 30-step test case is about 19 KB.

The cap is **500 test cases**, and the panel shows the live count and the actual
bytes in use (`chrome.storage.local.getBytesInUse`) next to the download buttons.
Measured at that cap: ~3.3 MB for 500 short cases, ~9 MB at 30 steps each, ~18 MB
at 60. The last figure is past the 10 MB default quota, so the manifest asks for
`unlimitedStorage` — it adds no install-time warning, and without it a team with
substantial test cases would hit a write failure somewhere north of 300 saves.

The cap used to truncate with `slice(0, MAX)`, which dropped the **oldest** saved
case without a word. It now refuses the save with a message naming the limit, and
a quota failure is translated into "export the library, then clear some cases"
rather than a raw `QUOTA_BYTES quota exceeded`.

### YAML export

**Test cases (YAML)** writes a readable, diff-friendly document — the reason to
pick YAML over JSON. One `testCases` list, each with `steps`, each step carrying
its `element` (name, type, testId, xpath, css), its `frame` chain when it happened
inside an iframe, and `value` for an action or `expected` for an assertion. A
secret step is marked `secret: true` with no value.

It is an **export only**. The importable round-trip format is still the library
JSON: reading YAML back would mean writing a parser as well, and MV3 rules out
pulling one in.

`lib/export/yaml.ts` emits it directly, and the scalar quoting there is the whole
job. The values are hostile to naive serialisation:

- XPath expressions are full of `"`, `[`, `@` and `:`
- a typed card number must stay `"4242424242424242"`, not become a float; `1.10`
  must not become `1.1`; `007` must keep its zeros
- `no`, `yes`, `on`, `off`, `~`, `null` are booleans and null under YAML 1.1 — an
  element literally labelled "No" would otherwise round-trip as `false`

Anything not provably safe as a plain scalar falls back to `JSON.stringify`, which
is a valid YAML double-quoted scalar (the escape sets are identical) — so the hard
cases are handled by a function that is already correct rather than by more rules.

Verified by parsing the output back with PyYAML and comparing every value against
what went in: 20 assertions over 30 deliberately hostile strings.

### Spreadsheet export

**CSV** and **Excel (.xlsx)** sit alongside the code formats, for teams who keep
test cases in a sheet or import them into TestRail / Zephyr / Xray.

Columns: Test Case, Step, Action, Element, Element Type, Frame, XPath, CSS
Selector, Test ID, Value, Note, URL. The workbook has a second **Issues** sheet —
one row per detected bug, with the step it followed. Both sheets get a frozen
header row and an autofilter, because this file exists to be sorted and filtered.

No spreadsheet library is bundled. An .xlsx is a ZIP of XML parts, and MV3
forbids remote code, so `lib/export/zip.ts` writes the archive directly (stored
entries, ~120 lines) instead of shipping hundreds of kilobytes of dependency for
a few KB of output.

Two details that are easy to get wrong and were verified rather than assumed:

- The CSV carries a **UTF-8 BOM**. Excel sniffs encoding, and without it reads
  UTF-8 as the local codepage — turning every Persian element name into mojibake.
- Step numbers and issue counts are written as **numbers**, not text, so sorting
  a column does not order 10 before 2.

Verified by reading the generated workbook back with openpyxl: 19 assertions on
the xlsx (sheet names, frozen panes, autofilter, numeric cells, Persian text,
embedded newlines/quotes/commas, password redaction) and 7 on the CSV.

**"Download all as one file"** produces a single runnable file rather than a
folder of separate downloads:

- Playwright → several `test()` blocks in one spec
- Cypress → several `it()` blocks in one `describe`
- Selenium → several `def test_*` in one module
- Markdown → one document, one section per case
- CSV / Excel → every case in one sheet, distinguished by the Test Case column

A Persian test-case title becomes `def test_case_N` in Selenium (a Python
identifier only accepts ASCII here) with the original title preserved as a
docstring.

## What gets detected

The page's `console.error` / `console.warn`, uncaught errors, unhandled promise
rejections, `fetch` and `XMLHttpRequest` failures, 4xx/5xx responses, and
resources that failed to load.

Collection is **always on**, not only while recording — nobody presses record
before seeing a bug. A cap of 40 reports per 5 seconds stops a render loop from
flooding the panel.

Detected bugs are never turned into assertions, only into trailing comments:
asserting a bug passes would freeze it in place.

## Fonts

The UI is English and renders in the system face. But recorded data is not UI
text: capturing a flow on a Persian site fills the step list with Persian element
names, so **Vazirmatn** (SIL OFL 1.1) is bundled to render those.

The `unicode-range` on that `@font-face` is load-bearing, not an optimisation.
Vazirmatn has to sit *before* the system face in the stack, because per-glyph
fallback only advances when the current family lacks the glyph — and macOS
system-ui does cover Arabic, so a Vazirmatn placed later is never reached.
Declaring the range instead gives all three properties at once:

- Latin codepoints fall straight through to the system face
- Persian codepoints resolve to Vazirmatn
- the 111KB file is not requested at all until Persian text is rendered

Verified by measurement: a space-free Persian string renders at exactly the
Vazirmatn width and not the system-ui width, while Latin renders at exactly the
system-ui width. Spaces come from the system face (U+0020 is deliberately outside
the range, so Vazirmatn never claims spaces in English text) — the same trade-off
every Google Fonts subset makes.

Elements holding page-derived text use `dir="auto"`, so an RTL element name
renders correctly inside the LTR panel.

IRANSans was considered and dropped. It is neither a system font nor on any
public CDN, so it renders nothing without shipping the file — and it is
proprietary (free for personal use, commercial use requires a FontIran licence),
which makes bundling it into a distributed extension a licensing question.

## iframes

Both content scripts run in **every** frame, so a click inside a payment, SSO or
3DS iframe is recorded instead of silently dropped.

The hard part is not capturing the event — it is naming the frame in a way that
survives into a generated test. A Chrome frame id means nothing at replay time,
so what a step stores is a **locator for the `<iframe>` element itself**, as seen
from its parent document (`RecordedStep.framePath`).

A cross-origin frame cannot read its parent's DOM, so it asks instead
(`lib/frame-path.ts`): it posts "which iframe am I?" upwards, and the parent —
which owns that element and has its own content script — answers with its own
path plus a locator for the child. The recursion ends at the top frame, whose
path is empty. Replies are accepted only from `window.parent`, so another frame
on the page cannot forge a path.

The iframe locators go through the same selector engine as everything else, so a
frame with `data-testid` is targeted by it rather than by position.

### What each framework can express

| | Support |
|---|---|
| Playwright | Full, any depth — `page.frameLocator(a).frameLocator(b).getBy…` |
| Selenium | Full, any depth. The driver has one current frame, so the generator descends from `default_content()` and only re-switches when the frame actually changes |
| Cypress | One level, via the cypress-iframe plugin. Deeper chains are emitted **commented out** with the frame chain in a FIXME |
| Markdown | A Frame column showing the chain |

Two cases deliberately produce commented-out code rather than something that
looks right and fails: a nested chain in Cypress, and a frame whose identity
never resolved (`FrameRef.unresolved`). An empty `frameLocator('')` or
`By.XPATH, ""` does not merely miss the element — it throws and takes the rest of
the test with it. The action is emitted as a comment, minus its unusable frame
wrapper, so the file still runs and the gap is visible.

URL assertions are refused inside an iframe: they would assert the frame's own
URL, which no framework expresses cleanly. The recorder says so on screen rather
than recording something misleading.

An iframe with no `src` and no `name` — TinyMCE and other embedded editors build
theirs in JavaScript — is handled the same way as any other: the chain stores a
locator for the element, which for `<iframe id="mce_0_ifr">` is `#mce_0_ifr`.
Verified against https://the-internet.herokuapp.com/iframe.

A click on empty page background resolves to `<html>`, whose locator `/html` is
valid XPath and a useless test step. It is normalised to `body` instead of being
dropped, because clicking the background to dismiss a menu is a real test action.
The root and body also report no accessible name: their `innerText` is the whole
document, which as a step label reads like a real element name and is worse than
an empty one.

## Known limits of this phase

- No screenshots or annotation.
- Assertions can only be added from the context menu; their expected value
  cannot be edited in the panel afterwards.
- No API mocking.
- Cannot be injected into `chrome://` pages, the Chrome Web Store, or the PDF
  viewer — a Chrome restriction, not something the extension can work around.

## Commands

```bash
npm run dev       # dev build + hot reload
npm run build     # production build in dist/chrome-mv3
npm run zip       # Web Store upload package
npm run compile   # typecheck only
```
