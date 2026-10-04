function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}

/** For a jump that a re-render follows at once: a smooth scroll can be cut short by the layout change. */
export function jumpToTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function scrollIntoViewGently(el: Element) {
  el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
}
