"use client";

import React, { useState, useEffect, useCallback, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "?", description: "Mostrar atajos de teclado" },
  { keys: "F2", description: "En POS: enfocar búsqueda de producto" },
  { keys: "F9", description: "En POS: continuar al pago" },
  { keys: "Escape", description: "Cerrar diálogo o panel" },
  { keys: "Tab", description: "Navegar entre elementos enfocables" },
];

function isInputLike(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  const role = target.getAttribute?.("role");
  const editable = target.getAttribute?.("contenteditable");
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    editable === "true" ||
    role === "textbox" ||
    role === "searchbox"
  );
}

interface KeyboardShortcutsProviderProps {
  children: ReactNode;
}

/**
 * Global shortcuts plus POS keyboard acceleration.
 * F2 focuses the product search and F9 opens the payment step while on /sales.
 */
export function KeyboardShortcutsProvider({
  children,
}: KeyboardShortcutsProviderProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "?" && !isInputLike(e.target as EventTarget | null)) {
      e.preventDefault();
      setOpen(true);
      return;
    }

    if (pathname !== "/sales") return;

    if (e.key === "F2") {
      e.preventDefault();
      const search = document.querySelector<HTMLInputElement>('input[placeholder*="Buscar producto"]');
      search?.focus();
      search?.select();
      return;
    }

    if (e.key === "F9") {
      e.preventDefault();
      const paymentButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("Continuar al pago"));
      paymentButton?.click();
    }
  }, [pathname]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-md"
          aria-describedby="keyboard-shortcuts-description"
        >
          <DialogHeader>
            <DialogTitle>Atajos de teclado</DialogTitle>
            <DialogDescription id="keyboard-shortcuts-description">
              Usa estos atajos para trabajar más rápido sin salir del teclado.
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            {SHORTCUTS.map(({ keys, description }) => (
              <li
                key={keys}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 dark:border-white/10 bg-white/5 dark:bg-white/5 px-2 py-2"
              >
                <kbd className="font-mono text-xs font-medium text-foreground rounded border border-white/20 dark:border-white/20 bg-white/10 dark:bg-white/10 px-2 py-1">
                  {keys}
                </kbd>
                <span>{description}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
