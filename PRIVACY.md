# Privacy Policy — QA Test Case Recorder

**Last updated: 24 August 2026**

## Summary

QA Test Case Recorder records what you do on a web page and turns it into a test
case. Everything it records stays on your own computer, in your browser's local
extension storage.

The extension makes **no network requests of its own**. There is no server, no
account, no analytics, no telemetry, and no crash reporting. Nothing you record is
transmitted anywhere, and the author of this extension cannot see any of it.

## What the extension records

Only in a tab where you have explicitly pressed **Start recording**:

- **Element identifiers** — XPath expressions, CSS selectors and `data-testid`
  values for the elements you interact with.
- **Visible text** — the label or text of those elements, so a step reads as
  "Click the Log in button".
- **Values you enter** — text you type, options you select, and checkbox states.
- **Page addresses** — the URL of each page you visit during the recording.
- **Iframe identifiers** — a selector for any `<iframe>` your interaction happened
  inside.

Independently of recording, in every tab the extension is loaded into, it also
collects **error information reported by the page itself**:

- `console.error` and `console.warn` messages
- uncaught JavaScript errors and unhandled promise rejections
- failed network requests, HTTP 4xx/5xx response codes, and the URLs involved
- resources such as images or scripts that failed to load

This is what makes the extension able to tell you which action broke something. It
is collected in memory and written to local storage only while a recording is
active.

## What it does not record

- **Passwords are not stored.** A password field is read only in order to compare
  its contents, in memory, against the test-data variables you defined yourself.
  Only the *name* of the matching variable is saved. If it matches nothing, the
  step is saved with no value at all.
- No keystroke logging outside the fields you fill during a recording.
- No browsing history, bookmarks, downloads, cookies or saved credentials.
- No screenshots.
- No page content beyond the elements you interacted with and the error messages
  described above.

## Test data you define

Under **Tools → Test data** you may store named values your test scenarios reuse,
such as a test account's phone number and password.

These values are stored **unencrypted** in your browser's local extension storage,
in the same way a `.env` file sits unencrypted on a disk. Anyone with access to
your computer and your Chrome profile can read them.

**Use test-account credentials only. Do not store a real user's password, or any
credential whose disclosure would matter.**

Values you mark as **secret** are never written into any exported file or shared
library file — only the variable's name appears there.

## Where the data is stored

In `chrome.storage.local`, which belongs to your Chrome profile on your device.

Data leaves your device only when **you** choose to move it:

- pressing **Download** or **Export**, which writes a file to your computer
- pressing **Copy**, which places text on your clipboard

What happens to a file after you download it — committing it to a repository,
attaching it to a Jira ticket, sending it to a colleague — is your decision and
outside the extension's control. Note that exported files contain element
selectors, page URLs and any values you entered that were not defined as
variables.

## How long it is kept

Until you delete it. Recordings for a tab are discarded when that tab is closed.
Saved test cases and test-data variables persist until you delete them in the
panel, or until the extension is removed — Chrome erases an extension's storage
when it is uninstalled.

**Removing the extension deletes your saved test cases permanently.** Use
**Export library file** first if you want to keep them.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | To keep your recordings and test data on your device. The library can hold up to 500 test cases, which exceeds the default storage quota. |
| `tabs` | The side panel is not attached to a tab, so it needs the active tab's id to know which recording to show. Only the tab id and load state are read. |
| `scripting` | To insert the recorder into a tab that was already open before the extension was installed. |
| `contextMenus` | To provide the right-click "add assertion" entry. |
| `sidePanel` | The extension's interface is a side panel. |
| Access to all websites | You choose which application to test, and its address cannot be known in advance. Interaction is observed only in a tab where you started recording. |

## Third parties

None. No data is sold, shared, or transferred to anyone. No third-party
service, SDK or analytics provider is included in the extension.

## Remote code

The extension executes no remote code. Everything runs from the files in the
installed package, as required by Chrome's Manifest V3.

## Children

The extension is a developer and QA tool and is not directed at children.

## Changes to this policy

Any change will be published at this address with an updated date above.

## Contact

<!-- Replace with a real address before publishing; the Chrome Web Store requires
     a reachable contact for the developer account. -->
**[your-email@example.com]**
