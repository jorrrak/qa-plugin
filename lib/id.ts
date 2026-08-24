let counter = 0;

/** Short unique id. Not cryptographic — it only needs to be unique per session. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
