export const canonicalizeLabelName = (name: string): string =>
  name
    .trim()
    // Treat separators as equivalent so needs_action, needs-action, and needs action collide.
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
