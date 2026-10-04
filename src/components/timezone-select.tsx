"use client";

import { useMemo, useState } from "react";
import { Listbox } from "@/components/listbox";
import { timezoneOptions } from "@/lib/timezones";

/** A searchable listbox of IANA timezones. The server validates the submitted name. */
export function TimezoneSelect({
  id = "timezone",
  name = "timezone",
  value,
  defaultValue,
  onChange,
  required,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const current = value ?? defaultValue;
  // The list is fixed for the page's life; offsets are computed once, on first render.
  const [now] = useState(() => new Date());
  const options = useMemo(() => timezoneOptions(current, now), [current, now]);
  return (
    <Listbox
      id={id}
      name={name}
      options={options}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      required={required}
      requiredMessage="Elige una zona horaria"
      searchable
      searchPlaceholder="Busca por ciudad, región o desfase"
      emptyText="Ninguna zona horaria coincide"
      data-testid="timezone-select"
    />
  );
}
