/**
 * A practical subset of the accessible-name computation. Not spec-complete —
 * it covers the cases a tester actually points at (buttons, links, fields,
 * icon-only controls) and stops there.
 */

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function visibleText(el: Element): string {
  // innerText already skips display:none and collapses whitespace the way the
  // user sees it, which is exactly what we want for a human-readable name.
  const text = clean((el as HTMLElement).innerText);
  if (text) return text;
  // Icon-only controls: an <svg><title> is the only label present.
  return clean(el.querySelector('svg > title')?.textContent);
}

function labelText(el: Element): string {
  const id = el.getAttribute('id');
  if (id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel) return visibleText(forLabel);
  }
  const wrapping = el.closest('label');
  if (wrapping) return visibleText(wrapping);
  return '';
}

/** The label a human would use when saying "click X". Never longer than needed. */
export function accessibleName(el: Element): string {
  // The root and body have no name. Their innerText is the whole document, which
  // as a step label is worse than nothing — it reads like a real element name.
  if (el === el.ownerDocument.documentElement || el === el.ownerDocument.body) {
    return '';
  }

  const ariaLabel = clean(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node != null)
      .map(visibleText)
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const tag = el.localName;

  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const fromLabel = labelText(el);
    if (fromLabel) return fromLabel;

    const input = el as HTMLInputElement;
    const type = clean(input.type).toLowerCase();
    // For push buttons the value *is* the visible caption.
    if (['button', 'submit', 'reset'].includes(type) && clean(input.value)) {
      return clean(input.value);
    }
    if (type === 'image' && clean(input.alt)) return clean(input.alt);
    const placeholder = clean(input.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    const title = clean(input.getAttribute('title'));
    if (title) return title;
    const name = clean(input.getAttribute('name'));
    if (name) return name;
    return '';
  }

  if (tag === 'img') {
    return clean(el.getAttribute('alt')) || clean(el.getAttribute('title'));
  }

  const text = visibleText(el);
  if (text) return text;

  return clean(el.getAttribute('title'));
}

/** Names longer than this are almost always a whole container, not a control. */
export const MAX_NAME_LENGTH = 80;

export function shortName(el: Element): string {
  const name = accessibleName(el);
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}
