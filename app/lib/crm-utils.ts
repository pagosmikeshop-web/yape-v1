export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
}
