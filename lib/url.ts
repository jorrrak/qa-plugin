/**
 * The two URL questions the recorder has to answer, in one place because the
 * background and the panel must answer them identically: a panel that offers to
 * record a page the background will refuse is worse than either behaviour alone.
 */

/** Only a page the generated script could actually open. */
export function isRecordableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * Same page, allowing for the normalisation Chrome and the DOM disagree about —
 * `https://x.com` from a tab and `https://x.com/` from `location.href` are the
 * same place, and treating them as different adds a duplicate `goto` to the top
 * of every resumed recording.
 */
export function sameLocation(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

/** What a URL looks like in the panel header: enough to recognise, short enough to fit. */
export function shortUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
