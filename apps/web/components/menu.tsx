"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./menu.module.css";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  checked?: boolean;
}

/** A button that opens a keyboard-usable menu (arrows, Home/End, Escape returns focus). */
export function Menu({
  label,
  trigger,
  items,
  placement = "up",
}: {
  label: string;
  trigger: ReactNode;
  items: (MenuItem | "separator")[];
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => nodes[(i + nodes.length) % nodes.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(nodes.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className={`${styles.menu} ${placement === "up" ? styles.up : styles.down}`}
          onKeyDown={onKeyDown}
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} role="separator" className={styles.sep} />
            ) : (
              <button
                key={item.label}
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                tabIndex={-1}
                className={styles.item}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.checked && <span className={styles.check}>✓</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
