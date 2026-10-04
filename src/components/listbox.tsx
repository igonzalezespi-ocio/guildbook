"use client";

import clsx from "clsx";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filterOptions, type KeyState, listboxKey, type ListboxOption } from "@/lib/listbox";

export type { ListboxOption };

const TYPEAHEAD_RESET_MS = 600;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

export function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden className={clsx("shrink-0", className)}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden className="shrink-0 text-gold">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function placePopover(pop: HTMLElement, anchor: HTMLElement | null, align: "start" | "end") {
  const a = anchor?.getBoundingClientRect();
  if (!a) return;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const below = vh - a.bottom - VIEWPORT_MARGIN;
  const above = a.top - VIEWPORT_MARGIN;
  const natural = Math.min(pop.scrollHeight, POPOVER_MAX_HEIGHT);
  const up = below < natural && above > below;
  const maxWidth = Math.min(448, vw - VIEWPORT_MARGIN * 2);
  pop.style.minWidth = `${Math.min(a.width, maxWidth)}px`;
  pop.style.maxWidth = `${maxWidth}px`;
  pop.style.maxHeight = `${Math.max(120, Math.min(POPOVER_MAX_HEIGHT, up ? above : below))}px`;
  const width = pop.offsetWidth;
  const left = align === "end" ? a.right - width : a.left;
  pop.style.left = `${Math.min(Math.max(left, VIEWPORT_MARGIN), vw - width - VIEWPORT_MARGIN)}px`;
  pop.style.top = up ? "auto" : `${a.bottom + 4}px`;
  pop.style.bottom = up ? `${vh - a.top + 4}px` : "auto";
}

/**
 * Places a popover (in the top layer where supported, so no container clips it) under its anchor, or above when
 * there is more room there, and keeps it attached while the page scrolls or resizes.
 */
export function usePopoverPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  align: "start" | "end" = "start",
) {
  useLayoutEffect(() => {
    const pop = popover.current;
    if (!open || !pop) return;
    try {
      pop.showPopover?.();
    } catch {
      // Already shown, or the element isn't a popover in this browser; fixed positioning still applies.
    }
    const place = () => placePopover(pop, anchor.current, align);
    place();
    const onScroll = (e: Event) => {
      if (!pop.contains(e.target as Node)) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      try {
        pop.hidePopover?.();
      } catch {
        // Already hidden.
      }
    };
  }, [open, anchor, popover, align]);
}

const POPOVER_CLASS =
  "fixed inset-auto m-0 flex flex-col overflow-hidden rounded border border-line bg-ink-2 p-0 text-bone shadow-[0_12px_32px_rgb(0_0_0/0.45)]";

export interface ListboxProps {
  options: readonly ListboxOption[];
  /** Submitted with the form under this name. */
  name?: string;
  /** Trigger id, for a `<label htmlFor>`. */
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shown while no option is chosen. Without it the first option starts chosen, like a native select. */
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  required?: boolean;
  /** Message shown when a required listbox is submitted empty. */
  requiredMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Adds a filter box above the options, for long lists. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  size?: "sm" | "md";
  className?: string;
  triggerClassName?: string;
  /** Replaces the chosen option's label in the trigger. */
  renderValue?: (option: ListboxOption | undefined) => ReactNode;
  "data-testid"?: string;
}

/**
 * A select-only combobox (WAI-ARIA APG) in the site's style: a button showing the choice, a listbox popover with
 * optional icons, descriptions, groups and a filter box. The value is submitted through a hidden input, so it works in
 * `ActionForm`, which marks the trigger invalid through `data-field-name`.
 */
export function Listbox({
  options,
  name,
  id,
  value: controlled,
  defaultValue,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  required = false,
  requiredMessage = "Elige una opción",
  disabled = false,
  invalid = false,
  searchable = false,
  searchPlaceholder = "Buscar",
  emptyText = "Sin resultados",
  size = "md",
  className,
  triggerClassName,
  renderValue,
  "data-testid": testId,
}: ListboxProps) {
  const initial = defaultValue ?? (placeholder !== undefined ? "" : (options.find((o) => !o.disabled)?.value ?? ""));
  const [inner, setInner] = useState(initial);
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);
  const [labelText, setLabelText] = useState<string | undefined>(ariaLabel);
  const buffer = useRef("");
  const bufferTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const touchOpen = useRef(false);
  const defaultRef = useRef(initial);
  useEffect(() => {
    defaultRef.current = initial;
  });

  const base = useId().replace(/:/g, "");
  const triggerId = id ?? `${base}-trigger`;
  const listId = `${base}-list`;
  const missingId = `${base}-missing`;
  const optionId = (i: number) => `${base}-opt-${i}`;

  const visible = useMemo(() => (searchable ? filterOptions(options, query) : [...options]), [options, query, searchable]);
  const selected = options.find((o) => o.value === value);
  const selectedIndex = visible.findIndex((o) => o.value === value);

  useEffect(() => {
    const form = wrapperRef.current?.closest("form");
    if (!form || controlled !== undefined) return;
    const onReset = () => {
      setInner(defaultRef.current);
      setMissing(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled]);

  usePopoverPlacement(open, triggerRef, popoverRef);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => {
    if (open && searchable && !touchOpen.current) searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  const openList = (at: number) => {
    setLabelText(ariaLabel ?? triggerRef.current?.labels?.[0]?.textContent ?? undefined);
    setQuery("");
    setActive(at);
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    buffer.current = "";
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const commit = (option: ListboxOption | undefined) => {
    if (!option || option.disabled) return;
    if (controlled === undefined) setInner(option.value);
    setMissing(false);
    if (option.value !== value) onChange?.(option.value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    const searching = e.currentTarget === searchRef.current;
    if (searchable && !searching && !open && e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      touchOpen.current = false;
      openList(selectedIndex);
      setQuery(e.key);
      setActive(filterOptions(options, e.key).length > 0 ? 0 : -1);
      return;
    }
    const state: KeyState = { open, active, selected: selectedIndex, buffer: buffer.current };
    const next = listboxKey(e, state, visible, searching);
    if (next.handled) e.preventDefault();
    buffer.current = next.buffer;
    clearTimeout(bufferTimer.current);
    if (next.buffer) bufferTimer.current = setTimeout(() => (buffer.current = ""), TYPEAHEAD_RESET_MS);
    if (next.commit !== undefined) commit(visible[next.commit]);
    if (next.open && !open) {
      touchOpen.current = false;
      openList(next.active);
    } else if (!next.open && open) close(e.key !== "Tab");
    else setActive(next.active);
  };

  const shown = renderValue ? renderValue(selected) : (selected?.label ?? (value || placeholder));
  const isInvalid = invalid || missing;
  const describers = [describedBy, missing ? missingId : undefined].filter(Boolean).join(" ") || undefined;
  const activeId = open && active >= 0 && visible[active] ? optionId(active) : undefined;

  let lastGroup: string | undefined;
  const rows: ReactNode[] = [];
  let groupRows: ReactNode[] = [];
  const flush = () => {
    if (lastGroup === undefined) rows.push(...groupRows);
    else {
      const headingId = `${base}-group-${rows.length}`;
      rows.push(
        <div key={headingId} role="group" aria-labelledby={headingId}>
          <div id={headingId} role="presentation" className="px-3 pt-2 pb-1 text-[0.65rem] font-semibold tracking-wider text-gold-dim uppercase">
            {lastGroup}
          </div>
          {groupRows}
        </div>,
      );
    }
    groupRows = [];
  };
  visible.forEach((o, i) => {
    if (i > 0 && o.group !== lastGroup) flush();
    lastGroup = o.group;
    const isSelected = o.value === value;
    groupRows.push(
      <div
        key={`${o.value}-${i}`}
        id={optionId(i)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={o.disabled || undefined}
        data-value={o.value}
        data-active={i === active || undefined}
        onPointerMove={() => i !== active && !o.disabled && setActive(i)}
        onClick={(e) => {
          e.preventDefault();
          if (o.disabled) return;
          commit(o);
          close(true);
        }}
        className={clsx(
          "flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm select-none sm:min-h-9",
          i === active && "bg-gold/10",
          isSelected && "text-gold",
          o.disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {o.icon && (
          <span aria-hidden className="flex w-5 shrink-0 items-center justify-center">
            {o.icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate" style={o.color ? { color: o.color } : undefined}>
            {o.label}
          </span>
          {o.description && <span className="block text-xs text-muted">{o.description}</span>}
        </span>
        <span className="flex w-4 shrink-0 justify-end">{isSelected && <Check />}</span>
      </div>,
    );
  });
  flush();

  return (
    <div
      ref={wrapperRef}
      className={clsx("relative", className)}
      data-testid={testId}
      onBlur={(e) => {
        if (open && !wrapperRef.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) close(false);
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        data-field-name={name}
        data-listbox-trigger=""
        data-value={value}
        {...(searchable
          ? { "aria-haspopup": "listbox" as const }
          : { role: "combobox", "aria-haspopup": "listbox" as const, "aria-activedescendant": activeId, "aria-required": required || undefined })}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-describedby={describers}
        {...(isInvalid ? { "aria-invalid": true } : {})}
        onPointerDown={(e) => {
          touchOpen.current = e.pointerType === "touch";
        }}
        onClick={() => (open ? close(true) : openList(selectedIndex >= 0 ? selectedIndex : visible.findIndex((o) => !o.disabled)))}
        onKeyDown={onKeyDown}
        className={clsx(
          "field flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-300/70",
          "cursor-pointer",
          size === "sm" && "min-h-9 py-1 text-sm",
          triggerClassName,
        )}
      >
        {selected?.icon && (
          <span aria-hidden className="flex w-5 shrink-0 items-center justify-center">
            {selected.icon}
          </span>
        )}
        <span
          className={clsx("min-w-0 flex-1 truncate", !selected && !value && "text-muted")}
          style={selected?.color && !renderValue ? { color: selected.color } : undefined}
        >
          {shown}
        </span>
        <Chevron className={clsx("text-gold-dim transition-transform", open && "rotate-180")} />
      </button>

      {name !== undefined &&
        (required ? (
          <input
            tabIndex={-1}
            aria-hidden
            required
            name={name}
            value={value}
            onChange={() => {}}
            data-listbox-value=""
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
            onInvalid={(e) => {
              e.preventDefault();
              setMissing(true);
              if (e.currentTarget.form?.querySelector(":invalid") === e.currentTarget) triggerRef.current?.focus();
            }}
          />
        ) : (
          <input type="hidden" name={name} value={value} data-listbox-value="" />
        ))}
      {missing && (
        <p id={missingId} className="mt-1 text-xs text-red-300">
          {requiredMessage}
        </p>
      )}

      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          className={POPOVER_CLASS}
          onMouseDown={(e) => {
            if (e.target !== searchRef.current) e.preventDefault();
          }}
        >
          {searchable && (
            <div className="border-b border-line p-1.5">
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={activeId}
                aria-label={labelText ? `Buscar: ${labelText.toLowerCase()}` : "Buscar"}
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(filterOptions(options, e.target.value).length > 0 ? 0 : -1);
                }}
                onKeyDown={onKeyDown}
                className="w-full rounded border border-line bg-ink px-2.5 py-1.5 text-base text-bone outline-none placeholder:text-muted focus:border-gold-dim sm:text-sm"
              />
            </div>
          )}
          <div id={listId} role="listbox" aria-label={labelText} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {rows}
          </div>
          {visible.length === 0 && (
            <p role="status" className="px-3 py-2 text-sm text-muted italic">
              {emptyText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
