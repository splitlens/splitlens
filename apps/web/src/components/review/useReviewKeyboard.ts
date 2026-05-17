"use client";

/**
 * useReviewKeyboard — global key handler for the /review page navigation.
 *
 * Maps:
 *   J        → next row in the visible list
 *   K        → previous row in the visible list
 *   N        → next UNREVIEWED row (skips reviewed)
 *
 * S and A (save / save+reviewed) live inside ReviewForm because they need
 * access to the form's local state. We deliberately split nav vs save
 * keybindings across the two hooks so each owner is the source of truth
 * for the keys it knows how to handle.
 *
 * No-op when a typing element has focus (input/textarea/select/contentEditable)
 * — typing "j" into the search field shouldn't fly the page to the next row.
 */
import { useEffect } from "react";

export interface UseReviewKeyboardArgs {
  onNext: () => void;
  onPrev: () => void;
  onNextUnreviewed: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useReviewKeyboard({
  onNext,
  onPrev,
  onNextUnreviewed,
}: UseReviewKeyboardArgs) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        onNext();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onNextUnreviewed();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNext, onPrev, onNextUnreviewed]);
}
