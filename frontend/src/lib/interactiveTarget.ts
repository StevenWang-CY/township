/** Shared guard for bare-key global shortcuts (T, ~, Space, arrows…):
 *  a key typed into a focused control is that control's input, never a
 *  page-level command. */
export function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    el.isContentEditable ||
    el.closest('[role="slider"]') !== null
  );
}
