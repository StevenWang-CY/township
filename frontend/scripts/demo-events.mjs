/** Privacy boundary shared by static-demo staging and its regression test. */
export const PRIVATE_EVENT_TYPES = new Set(["relationship_update"]);

export function publicDemoEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((event) => !PRIVATE_EVENT_TYPES.has(event?.type));
}
