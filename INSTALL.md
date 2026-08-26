# QA Test Case Recorder — install

A Chrome extension for QA: record test cases with XPath and the element's visible
name, generate automation scripts, and catch bugs as they happen.

## Install (5 steps, once)

Chrome cannot install a `.zip` directly — it only loads an unpacked folder. So:

1. **Unzip** this archive somewhere permanent, e.g. `~/Documents/QA test case recorder`.
   Do not leave it in Downloads: if the folder moves later, Chrome treats it as a
   different extension and your saved test cases stop showing up.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder — the one containing
   `manifest.json`.
5. Pin the icon: click the puzzle-piece icon next to the address bar, then the
   pin next to **QA Test Case Recorder**.

Click the toolbar icon to open the side panel.

## First run

1. Open the page you want to test.
2. Press **Start recording**. A red "● QA recording" badge appears top-right of
   the page.
3. Use the page normally. Clicks, typing, select changes and navigation are all
   captured, with the XPath and visible name of each element.
4. To add a check, **right-click** any element → **QA — add assertion**.
5. Open the **Script** tab for Playwright / Cypress / Selenium code, or the
   **Library** tab to save the test case and export it to Excel or CSV.

Password fields are never captured. The step is flagged and the generated script
reads `TEST_PASSWORD` from the environment instead, so a recorded login flow is
safe to commit.

## Where your test cases live

In Chrome's own storage, tied to **this Chrome profile on this machine**. They
are not shared with anyone automatically, and **uninstalling the extension
deletes them**.

To keep or share them, use the Library tab:

- **Export library file** → one `qa-library.json` holding everything. Commit it
  to the repo or put it in a shared folder.
- **Import library file…** → reads it back. Importing merges; nothing you already
  have is overwritten.

That JSON file is the only format that round-trips. A "Raw session (JSON)" export
is a different shape and cannot be imported.

**Export before you move the folder or remove the extension.** That file is the
only copy that does not depend on the Chrome profile or the extension id.

### A note for the team

Sharing is manual: if you do not export and push the file, your work is not
shared. Two people editing one shared `qa-library.json` will hit a git conflict
on a large JSON file, which is unpleasant to resolve — so keep one file per
person (`qa-library-<name>.json`) and import a teammate's file when you need
their cases.

The real system of record for automated tests should be the generated Playwright
specs in your repository. They are what CI runs and what gets code review. This
library is the scratchpad before that commit.

## Limits worth knowing

- Top frame and iframes are both recorded. Cypress output supports one iframe
  level; deeper chains come out commented with the frame chain noted.
- No screenshots or annotation yet.
- Cannot run on `chrome://` pages, the Chrome Web Store, or the PDF viewer — a
  Chrome restriction.
- Library cap: 500 test cases. It refuses the save at the limit rather than
  dropping anything.

## Updating

Replace the folder contents with a newer build, then press the reload button (🔄)
on the extension's card in `chrome://extensions`. A build that adds a permission
will not take effect until you do.

Your saved test cases survive a reload. They do **not** survive removing the
extension — export first.
