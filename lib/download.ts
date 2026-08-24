/**
 * Extension pages are not sandboxed, so a Blob URL plus a synthetic anchor click
 * is the whole download path — no `downloads` permission needed.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  // Revoking immediately is safe: the browser has already taken the blob.
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  // Revoking immediately is safe: the browser has already taken the blob.
  URL.revokeObjectURL(url);
}

export function slugify(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    // The Arabic/Persian range is kept on purpose: the UI is English but a
    // tester may still name a test case in Persian, and every target filesystem
    // handles those characters fine. Stripping them would collapse such a title
    // to the fallback and lose it.
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
