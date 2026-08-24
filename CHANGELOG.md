# Changelog

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
