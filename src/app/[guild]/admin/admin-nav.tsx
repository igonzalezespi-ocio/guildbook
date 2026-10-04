"use client";

import clsx from "clsx";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink } from "@/components/nav-link";
import { NavMenu, type NavMenuItem } from "@/components/nav-menu";

const TAB =
  "inline-flex min-h-10 items-center rounded-t border-b-2 border-transparent px-2 font-display text-xs tracking-wider text-muted uppercase hover:text-gold aria-[current=page]:border-gold aria-[current=page]:bg-gold/10 aria-[current=page]:text-gold xl:px-3";
const FADE = "1.5rem";

/**
 * The admin tabs: a horizontal scroller whose faded edges show there is more, scrolled to the open tab, with the
 * rarely used sections in a More menu.
 */
export function AdminNav({ links, more }: { links: readonly NavMenuItem[]; more: readonly NavMenuItem[] }) {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && tab) {
      const box = el.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      if (t.left < box.left || t.right > box.right) {
        el.scrollLeft += t.left - box.left - (box.width - t.width) / 2;
      }
    }
    measure();
  }, [pathname, measure]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const mask = `linear-gradient(to right, ${edges.start ? "transparent" : "#000"}, #000 ${FADE}, #000 calc(100% - ${FADE}), ${edges.end ? "transparent" : "#000"})`;

  return (
    <nav aria-label="Admin" className="-mx-4 mb-6 flex items-end border-b border-line px-4" data-testid="admin-nav">
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        data-overflow-start={edges.start || undefined}
        data-overflow-end={edges.end || undefined}
      >
        <ul className="flex gap-0.5 whitespace-nowrap">
          {links.map((l) => (
            <li key={l.href}>
              <NavLink href={l.href} exact={l.exact} className={TAB}>
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
      {more.length > 0 && (
        <NavMenu
          label="Más secciones de administración"
          items={more}
          className="shrink-0 border-l border-line/60 pl-0.5"
          buttonClassName={clsx(TAB, "cursor-pointer data-[current]:border-gold data-[current]:bg-gold/10 data-[current]:text-gold aria-expanded:text-gold")}
        >
          Más
        </NavMenu>
      )}
    </nav>
  );
}
