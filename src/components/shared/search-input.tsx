"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey, useHotkeyLabel } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Hotkey that focuses the field from anywhere on the page, e.g. `"/"` or
   * `"mod+k"`. The key is hinted inside the field.
   */
  shortcut?: string;
  /** Sets the width (default: full width, 16 rem from `sm`). */
  className?: string;
  autoFocus?: boolean;
  /** Accessible name (defaults to the placeholder). */
  label?: string;
  disabled?: boolean;
}

/**
 * Search field with a clear button. Escape clears the text, then leaves the
 * field. The value is controlled: debounce it with `useDebouncedValue` when
 * the filtering is expensive.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  shortcut,
  className,
  autoFocus,
  label,
  disabled,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutKeys = useHotkeyLabel(shortcut ?? "");

  useHotkey(
    shortcut ?? "",
    () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    { enabled: Boolean(shortcut) && !disabled },
  );

  return (
    <InputGroup className={cn("w-full sm:w-64", className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (value) {
            // Consumed here: an Escape that clears the text must not also
            // close the panel or dialog around the field.
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          } else {
            event.currentTarget.blur();
          }
        }}
        className="[&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Effacer la recherche"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : shortcut && shortcutKeys.length > 0 ? (
        // A keyboard hint is noise on touch screens and once the field has focus.
        <InputGroupAddon
          align="inline-end"
          aria-hidden="true"
          className="hidden group-has-[input:focus]/input-group:hidden sm:flex"
        >
          <Kbd>{shortcutKeys.join(" ")}</Kbd>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
