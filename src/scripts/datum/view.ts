// view.ts: run something once, the first time an element is far enough on screen.
// Shared by the Datum section scripts (archive, locators, progress charts). Whether anything
// may move is decided by src/components/ui/motion.ts, not here.

export function onFirstView(el: Element, ratio: number, callback: () => void): void {
  if (!('IntersectionObserver' in window)) {
    callback();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= ratio) {
          io.disconnect();
          callback();
        }
      }
    },
    { threshold: [0, ratio] },
  );
  io.observe(el);
}
