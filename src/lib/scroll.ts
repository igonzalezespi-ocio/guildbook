function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}

export function scrollIntoViewGently(el: Element) {
  el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
}
