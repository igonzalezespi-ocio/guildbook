import Link from "next/link";
import { Fragment } from "react";

/** Where a nested page sits; the last crumb is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="mb-4 text-xs tracking-wider text-muted uppercase">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && (
              <li aria-hidden="true" className="text-gold-dim">
                /
              </li>
            )}
            <li>
              {item.href && i < items.length - 1 ? (
                <Link href={item.href} className="hover:text-gold">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-bone">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
