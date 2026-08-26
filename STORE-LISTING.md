# Chrome Web Store submission

Everything needed for the listing, ready to paste. The upload package is
`dist/qa-test-case-recorder-<version>-chrome.zip`, produced by `npm run zip` —
that one has `manifest.json` at the root of the archive, which the store requires.
The distribution zips with a folder inside them are for `Load unpacked` and would
be **rejected** on upload.

## What only you can do

Publishing needs a Google sign-in, the one-time $5 developer registration fee, and
acceptance of the Developer Program Policies. Those are your account and your legal
agreement.

## Visibility — pick this deliberately

| Option | Who can install | Fits here? |
|---|---|---|
| **Private** | only accounts in your Google Workspace domain | **Best for an internal QA tool.** Needs the domain verified in the dashboard. |
| **Unlisted** | anyone with the link, not searchable | Good if the team is not all on one Workspace domain. |
| Public | anyone, searchable | Not what you want for an internal tool. |

Private or Unlisted still get reviewed, and still give automatic updates — which is
the whole reason to bother with the store instead of passing a zip around.

## Single purpose

> Authoring QA test cases from real browser interaction. The extension records a
> tester's actions on a page, turns them into a reusable test case, and exports it
> as an automation script or a test-management document. Recording, assertion
> capture, error collection and export are all steps of that one workflow.

The store rejects extensions that bundle unrelated features. The framing above is
accurate and keeps every feature inside one purpose — do not describe the parts as
separate tools.

## Short description (132 character limit — this is 108)

> Record test cases with XPath + accessible names, generate automation scripts, and
> catch bugs as they happen.

## Detailed description

> QA Test Case Recorder turns a manual test run into a reusable test case.
>
> Press record, use the page as you normally would, and every click, keystroke,
> selection and navigation is captured together with a robust XPath, a CSS
> selector and the element's visible name. Right-click any element to add an
> assertion — text, field value, visible, hidden, or the page URL.
>
> Export the result as a Playwright, Cypress or Selenium script, as a Markdown or
> YAML test case, as CSV or Excel, or in the column layout Zephyr Scale's importer
> expects.
>
> While you record, console errors, unhandled promise rejections, failed requests
> and 4xx/5xx responses are collected automatically — and each one is linked to
> the step it followed, so a console error becomes "clicking Save is broken".
>
> Built for real applications:
>
> • Locators avoid framework-generated ids such as React's `:r3:` or emotion's
>   `css-1a2b3c`, which change on every build and make recorded tests fail in CI
>   for no visible reason.
> • Recording works inside iframes, including cross-origin ones, and generated
>   scripts carry the frame chain.
> • Passwords are never captured. Define your test credentials once under Test
>   data, and recorded steps reference them by name while generated scripts read
>   them from the environment.
>
> Everything stays on your machine. No account, no server, no network requests.

## Category

Developer Tools

## Permission justifications

Paste each into the matching field on the Privacy practices tab. Vague answers are
the most common reason a submission with broad permissions gets held up.

**`storage`**
> Stores the user's recorded test cases and their test-data variable definitions
> locally, so a recording survives a page reload and a saved test case is still
> there tomorrow.

**`unlimitedStorage`**
> A test case with 60 recorded steps is roughly 36 KB, and the library holds up to
> 500 of them — about 18 MB, past the 10 MB default quota. Without this the user
> would hit a write failure partway through filling their library.

**`tabs`**
> The side panel is not bound to a tab, so it needs the active tab's id to show
> that tab's recording and to start and stop recording in it. Only the tab id and
> load state are used; no browsing history is read.

**`scripting`**
> Injects the recorder into a tab that was already open when the extension was
> installed — without it, pressing Start recording on such a tab would silently do
> nothing. Also runs the on-demand page checks in the Tools tab.

**`contextMenus`**
> Adds the "add assertion" right-click entry, which is how the user marks an
> expected result while recording.

**`sidePanel`**
> The extension's entire interface is a side panel. A popup closes the moment the
> user clicks the page they are testing.

**Host permission `<all_urls>`**
> The user chooses which application to test, and that is an internal or customer
> web app whose address the extension cannot know in advance. The content scripts
> observe interaction and page errors only in a tab where the user has explicitly
> started recording, and nothing is transmitted anywhere — all captured data stays
> in local extension storage.

**Remote code**
> No. Everything executes from the bundled package. No `eval`, no remote scripts,
> no CDN.

## Data usage disclosure

The dashboard asks which categories you collect. For this extension:

- **Website content** — yes. Element text, selectors and console/network error
  messages from pages the user records. Needed to produce the test case.
- Personally identifiable information, health, financial, authentication,
  location, personal communications, user activity — **no**.

Note on authentication: the extension does not capture passwords. A password field
is read only in memory to compare against the user's own test-data variables, and
only the variable name is stored.

Then certify all three:
- not being sold to third parties
- not used or transferred for a purpose unrelated to the single purpose
- not used or transferred to determine creditworthiness or for lending

A privacy policy URL is required once any data category is declared. A short page
stating that captured data stays in local browser storage and is never
transmitted is enough, but it has to be reachable at a public URL.

## Assets you still need

- **Screenshot**, at least one, 1280×800 or 640×400. Take it with the side panel
  open on a recorded flow, with the Script tab showing generated code — that is
  the screenshot that explains the product in one look. I cannot produce this;
  it needs the extension running in your Chrome.
- **Icon 128×128** — present, but it is a placeholder generated in code: a red dot
  on a dark rounded square. It reads fine at 16 px in the toolbar and looks thin
  on a store listing. Worth replacing before a public listing; acceptable for
  Private or Unlisted.
- Optional: a small promo tile, 440×280.

## Before you upload

1. `npm run zip`
2. Upload `dist/qa-test-case-recorder-<version>-chrome.zip`
3. Every version must have a **higher** version number than the last published
   one — the store refuses a re-upload of the same number.
4. Review takes anywhere from a few hours to a couple of weeks. Broad host
   permissions push it toward the longer end, which is what the justifications
   above are for.
