"use client";

/**
 * SplitTxnModal — focused per-transaction split decision UI.
 *
 * Visually distinct from InboxModal (which is category-first). This
 * modal puts who / balance / settlement at the top of the visual
 * hierarchy, and treats category as an after-thought.
 *
 *   Header        ← Prev · Next →  · Skip · Esc
 *   Big number    The txn amount, with direction tint
 *   Counterparty  Plain name + a "transferred via X" subtitle
 *
 *   SUGGESTED SPLIT (when we have a person_id → known person)
 *     "Split 2-way with Rahul · they'll owe you ₹2,100"
 *     [ Apply ↵ ]   [ Just me ]
 *
 *   FRIENDS PICKER
 *     [ Just me ] [ Split with friends ]
 *     friend chips (toggle to include)
 *     N-way · ₹X each
 *
 *   HOW OFTEN  (small, optional — only shows if user wants to set it)
 *     one-time · weekly · monthly · …
 *
 *   BULK RULE
 *     ☑ Always split "X" 2-way with Rahul  · applies to N other un-reviewed
 *
 *   Footer        Skip · Save & Next
 *
 * Wires into the existing applyMerchantRule + updateTransaction
 * server actions so the data semantics are identical to the
 * InboxModal — we just present a different view.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Ico } from "@/components/Ico";
import { fmtInr } from "@/lib/format";
import type {
  ReviewTransactionDetail,
  SplitQueueRow,
} from "@/lib/review-repo";
import {
  updateTransaction,
  applyMerchantRule,
  countOtherUnreviewedForMerchant,
  getTransactionDetailForSplit,
  getMerchantRecallContext,
  type MerchantRecallContext,
} from "@/app/review/actions";

/** Shape of a single nav entry surfaced by the strips/pickers. */
type NavEntry = { name: string; firstIndex: number; count: number };

/** Discriminant for which picker is open. All three are mutually
 *  exclusive — opening one closes the others so the user is never
 *  juggling open menus inside the same modal. The category and
 *  merchant pickers JUMP to a different row on Enter; the friend
 *  picker TOGGLES selection on Enter and stays open across multiple
 *  toggles (multi-select). */
type PickerDim = "category" | "merchant" | "friend";

export function SplitTxnModal({
  row,
  people,
  onClose,
  onPrev,
  onNext,
  onAfterSave,
  positionIdx,
  positionTotal,
  category,
  categoryNav,
  categoryNavIdx,
  onPrevCategory,
  onNextCategory,
  onJumpToCategory,
  merchant,
  merchantNav,
  merchantNavIdx,
  onPrevMerchant,
  onNextMerchant,
  onJumpToMerchant,
}: {
  row: SplitQueueRow;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAfterSave: () => void;
  positionIdx: number;
  positionTotal: number;
  /** Category-grouped nav context. The queue sorts rows by category
   *  so arrow-keying walks through all same-category txns before
   *  changing category. We surface progress + animate the header
   *  when the category changes between rows. */
  category: {
    name: string;
    positionInCategory: number;
    totalInCategory: number;
  };
  /** All categories present in the queue, in the order they appear.
   *  Used to drive the [/] keyboard jumps and the click-name picker.
   *  `firstIndex` is each category's first position in the flat queue
   *  — that's where category-jump lands. */
  categoryNav: NavEntry[];
  /** Index of the active row's category within categoryNav. -1 means
   *  the category isn't in the queue (shouldn't happen in practice).
   *  Used to disable prev/next buttons at the ends. */
  categoryNavIdx: number;
  onPrevCategory: () => void;
  onNextCategory: () => void;
  onJumpToCategory: (name: string) => void;
  /** Merchant-grouped nav context. Same shape as `category` but the
   *  group dimension is counterparty name. Merchants repeat across
   *  categories in the queue, so positionInMerchant counts the
   *  active row's place across the WHOLE flat queue (not within a
   *  single category). */
  merchant: {
    name: string;
    positionInMerchant: number;
    totalInMerchant: number;
  };
  merchantNav: NavEntry[];
  merchantNavIdx: number;
  onPrevMerchant: () => void;
  onNextMerchant: () => void;
  onJumpToMerchant: (name: string) => void;
}) {
  // Local form state — initialized from the row's current values.
  // Recurrence lives in the categorization modal (InboxModal at
  // /review/category), not here — splitting is about *who paid* and
  // *who owes what*, not about cadence.
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [shareCount, setShareCount] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [otherCount, setOtherCount] = useState(0);
  const [applyRule, setApplyRule] = useState(true);

  // Detail-pane state. Default closed — the modal stays narrow and
  // focused on the split decision. Click on the txn header card
  // (counterparty + amount block) toggles open; we lazy-fetch the
  // full ReviewTransactionDetail then. Cached per-row so re-opening
  // is instant.
  const [detailOpen, setDetailOpen] = useState(false);
  // Picker popover state. `activePicker` discriminates between the
  // category strip's picker and the merchant strip's picker; only
  // one can be open at a time so the user is never juggling two
  // menus inside the same modal. `pickerIndex` is the keyboard
  // highlight position within whichever list is currently active;
  // it resets each time the active picker changes (sync useEffect
  // below).
  const [activePicker, setActivePicker] = useState<PickerDim | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const pickerListRef = useRef<HTMLDivElement | null>(null);
  const pickerOpen = activePicker !== null;
  // Friend list shaped as NavEntry for the unified keyboard model.
  // `firstIndex` is unused for friends (no queue jump) — we keep the
  // shape for type compatibility with categoryNav/merchantNav. Sorted
  // by txnCount desc so the most-used friends sit first, same as the
  // chip list rendering below.
  const friendList = useMemo<NavEntry[]>(
    () =>
      [...people]
        .sort((a, b) => b.txnCount - a.txnCount)
        .map((p) => ({
          name: p.displayName,
          firstIndex: 0,
          count: p.txnCount,
        })),
    [people],
  );
  // Active list / current-idx / jump callback derived from the
  // discriminant. Keeps the keyboard handler dim-agnostic.
  const activeList =
    activePicker === "merchant"
      ? merchantNav
      : activePicker === "friend"
        ? friendList
        : categoryNav;
  // For friend, there's no single "current" — selection is multi
  // (sharedWith). Pass -1 so the picker's check-mark logic falls
  // through to the per-friend membership check we wire up below.
  const activeIdx =
    activePicker === "merchant"
      ? merchantNavIdx
      : activePicker === "friend"
        ? -1
        : categoryNavIdx;
  const onActivePickerJump = useCallback(
    (name: string) => {
      if (activePicker === "merchant") onJumpToMerchant(name);
      else if (activePicker === "category") onJumpToCategory(name);
      // friend dim doesn't jump — toggle handler is wired inline in
      // the keyboard handler.
    },
    [activePicker, onJumpToCategory, onJumpToMerchant],
  );
  // Close any open picker whenever the row changes — otherwise it
  // floats over the wrong category/merchant after nav.
  useEffect(() => {
    setActivePicker(null);
  }, [row.id]);
  // Sync the keyboard highlight to the active row each time the
  // picker opens (or swaps dimensions). Clamp to [0, len-1] in case
  // the underlying list rebuilt while the modal was alive.
  useEffect(() => {
    if (!pickerOpen) return;
    const start = Math.max(0, Math.min(activeList.length - 1, activeIdx));
    setPickerIndex(start < 0 ? 0 : start);
  }, [activePicker, pickerOpen, activeIdx, activeList.length]);
  // Scroll the highlighted row into view inside the (scrollable)
  // picker container. `block: "nearest"` keeps the highlight inside
  // the viewport without yanking it to center, so consecutive ↑/↓
  // feels like a smooth scroll along the list edge.
  useEffect(() => {
    if (!pickerOpen) return;
    const list = pickerListRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(
      `[data-picker-idx="${pickerIndex}"]`,
    );
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [pickerOpen, pickerIndex]);
  const [detail, setDetail] = useState<ReviewTransactionDetail | null>(null);
  const [recall, setRecall] = useState<MerchantRecallContext | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    // Reset detail + recall cache when the row changes; refetch only
    // if the pane is currently open. Detail and recall fire in
    // parallel — both are cheap indexed reads and they're independent.
    setDetail(null);
    setRecall(null);
    if (!detailOpen) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      getTransactionDetailForSplit(row.id),
      getMerchantRecallContext(row.counterparty, row.id, row.amount, 5),
    ]).then(([d, r]) => {
      if (cancelled) return;
      setDetail(d);
      setRecall(r);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.counterparty, row.amount, detailOpen]);

  // Category-change detection. The queue is sorted by category so
  // arrow-keying walks through same-category rows. When the category
  // shifts (last few Tea & Cigarettes done; first Food row appears)
  // we briefly highlight the category strip so the user sees the
  // transition. Tracked via useRef so it only flips on actual change,
  // not on every re-render.
  const prevCategoryRef = useRef<string | null>(null);
  const [categoryChanged, setCategoryChanged] = useState(false);
  useEffect(() => {
    const prev = prevCategoryRef.current;
    if (prev !== null && prev !== category.name) {
      setCategoryChanged(true);
      const t = window.setTimeout(() => setCategoryChanged(false), 700);
      prevCategoryRef.current = category.name;
      return () => window.clearTimeout(t);
    }
    prevCategoryRef.current = category.name;
  }, [category.name]);

  // Same pulse for merchant changes. Fires more often than category
  // (within a single category, multiple merchants show up), so the
  // visual cue is more useful for "wait, did I jump merchants?".
  const prevMerchantRef = useRef<string | null>(null);
  const [merchantChanged, setMerchantChanged] = useState(false);
  useEffect(() => {
    const prev = prevMerchantRef.current;
    if (prev !== null && prev !== merchant.name) {
      setMerchantChanged(true);
      const t = window.setTimeout(() => setMerchantChanged(false), 700);
      prevMerchantRef.current = merchant.name;
      return () => window.clearTimeout(t);
    }
    prevMerchantRef.current = merchant.name;
  }, [merchant.name]);

  // Reset state whenever the txn changes (when Prev/Next swaps the
  // row out from under us).
  useEffect(() => {
    setSharedWith([]);
    setShareCount(1);
    setErr(null);
    setApplyRule(true);
    let cancelled = false;
    countOtherUnreviewedForMerchant(row.counterparty, row.id).then((n) => {
      if (!cancelled) setOtherCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.counterparty]);

  const split = shareCount > 1 || sharedWith.length > 0;
  const ways = Math.max(shareCount, sharedWith.length + 1, split ? 2 : 1);
  const perPerson = ways > 0 ? row.amount / ways : row.amount;
  const yourShare = perPerson;
  const owedToYou = row.direction === "debit" ? row.amount - yourShare : 0;

  const toggleFriend = useCallback(
    (displayName: string) => {
      setSharedWith((prev) => {
        const next = prev.includes(displayName)
          ? prev.filter((n) => n !== displayName)
          : [...prev, displayName];
        // Bump shareCount up if adding a friend overflows the current
        // cap, but never reduce it — number keys (2-9) and J are the
        // explicit knobs for shrinking the way. This lets "3-way with
        // 1 named friend + 2 strangers" stay a valid configuration
        // when the user has explicitly set the way to 3.
        setShareCount((cur) => Math.max(cur, next.length + 1));
        return next;
      });
    },
    [],
  );

  const applySuggested = useCallback(() => {
    if (!row.suggestedSplitWith) return;
    setSharedWith([row.suggestedSplitWith]);
    setShareCount(2);
  }, [row.suggestedSplitWith]);

  const setJustMe = useCallback(() => {
    setSharedWith([]);
    setShareCount(1);
    // Exiting split mode closes the friend picker too — leaving it
    // open with no chips visible (split=false hides the chip grid)
    // would be a dead-end state.
    setActivePicker((cur) => (cur === "friend" ? null : cur));
  }, []);

  const save = useCallback(
    async (alsoReviewed: boolean) => {
      setSaving(true);
      setErr(null);
      const update = await updateTransaction(row.id, {
        sharedWith: split ? sharedWith : null,
        shareCount: split ? shareCount : 1,
        ...(alsoReviewed ? { markReviewed: true } : {}),
      });
      if (!update.ok) {
        setSaving(false);
        setErr(update.error);
        return;
      }
      // Bulk-apply share rule if the user kept the checkbox + there
      // are siblings. Split-only: this modal doesn't touch recurrence
      // (that's the category modal's job).
      if (applyRule && otherCount > 0 && split) {
        const bulk = await applyMerchantRule(row.counterparty, {
          sharedWith: split ? sharedWith : null,
          shareCount: split ? shareCount : 1,
        });
        if (!bulk.ok) {
          setSaving(false);
          setErr(`Saved this txn but rule failed: ${bulk.error}`);
          return;
        }
      }
      setSaving(false);
      onAfterSave();
    },
    [
      row.id,
      row.counterparty,
      sharedWith,
      shareCount,
      split,
      applyRule,
      otherCount,
      onAfterSave,
    ],
  );

  // Keyboard map.
  //   Default (no picker open):
  //     Enter       → save & advance
  //     Esc         → close modal
  //     ←/→         → prev/next txn
  //     /           → skip (same as →)
  //     Space       → toggle detail pane
  //     [ / ]       → prev/next category jump
  //     { / }       → prev/next merchant jump (Shift + [/])
  //     C           → open category picker
  //     M           → open merchant picker
  //     F           → open friend picker (enters split mode if not
  //                   already, defaults to 2-way)
  //     2 - 9       → set N-way split (enters split mode if not
  //                   already; doesn't open picker — just sets count)
  //     S           → apply suggested split
  //     J           → just me
  //   Picker mode (any picker open) — list-nav focus:
  //     ↑ / ↓       → move highlight
  //     Home/End    → first/last item
  //     Enter       → category/merchant: jump + close;
  //                   friend: toggle selection + stay open
  //                   (multi-select)
  //     Esc         → close picker
  //     C / M / F   → toggle to that dim's picker (or close if
  //                   already on the same dim)
  //     2 - 9       → set N-way split (picker stays open — useful
  //                   for "press F, press 3, pick 2 friends")
  //     all others  → trapped (don't change the underlying txn while
  //                   the user is mid-pick)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keys when the user is typing in an input.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      // Picker has its own keyboard model. Handle it first and bail
      // so global shortcuts don't fire under the open menu.
      if (pickerOpen) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerIndex((i) =>
            Math.min(activeList.length - 1, i + 1),
          );
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          setPickerIndex(0);
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          setPickerIndex(Math.max(0, activeList.length - 1));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const target = activeList[pickerIndex];
          if (target) {
            if (activePicker === "friend") {
              // Friend picker is multi-select — Enter toggles the
              // highlighted friend and the picker stays open so the
              // user can add more friends in rapid succession.
              toggleFriend(target.name);
            } else {
              onActivePickerJump(target.name);
              setActivePicker(null);
            }
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setActivePicker(null);
          return;
        }
        // C / M / F toggle dimensions: re-pressing the same key
        // closes the picker, pressing another swaps to that
        // dimension without an intermediate close.
        if (e.key === "c" || e.key === "C") {
          e.preventDefault();
          setActivePicker((cur) => (cur === "category" ? null : "category"));
          return;
        }
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          setActivePicker((cur) => (cur === "merchant" ? null : "merchant"));
          return;
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          // Entering friend picker bumps the way to at least 2 so
          // the chip grid renders.
          setShareCount((cur) => Math.max(cur, 2));
          setActivePicker((cur) => (cur === "friend" ? null : "friend"));
          return;
        }
        // 2-9 set the way (number of total people in the split).
        // Picker stays open — useful flow: press F to open friend
        // picker, press 3 to set 3-way, then ↑/↓/Enter to pick the
        // 2 friend slots.
        if (/^[2-9]$/.test(e.key)) {
          e.preventDefault();
          setShareCount(parseInt(e.key, 10));
          return;
        }
        // Trap any other key that would normally mutate the txn or
        // navigate away — the user is browsing the menu, not the
        // queue.
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === " " ||
          e.code === "Space" ||
          e.key === "[" ||
          e.key === "]" ||
          e.key === "{" ||
          e.key === "}" ||
          e.key === "/" ||
          e.key === "s" ||
          e.key === "S" ||
          e.key === "j" ||
          e.key === "J"
        ) {
          e.preventDefault();
          return;
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        void save(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" || e.key === "/") {
        e.preventDefault();
        onNext();
      } else if (e.key === " " || e.code === "Space") {
        // preventDefault stops Space from activating a focused
        // button (e.g. "Just me") AND stops the page from scrolling.
        e.preventDefault();
        setDetailOpen((v) => !v);
      } else if (e.key === "[") {
        e.preventDefault();
        onPrevCategory();
      } else if (e.key === "]") {
        e.preventDefault();
        onNextCategory();
      } else if (e.key === "{") {
        e.preventDefault();
        onPrevMerchant();
      } else if (e.key === "}") {
        e.preventDefault();
        onNextMerchant();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setActivePicker("category");
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setActivePicker("merchant");
      } else if (e.key === "f" || e.key === "F") {
        // F enters split mode (with a default 2-way) and opens the
        // friend picker so the user can immediately pick who to
        // split with — one keystroke "activate splitting".
        e.preventDefault();
        setShareCount((cur) => Math.max(cur, 2));
        setActivePicker("friend");
      } else if (/^[2-9]$/.test(e.key)) {
        // Number keys set the N-way split count. We don't auto-open
        // the friend picker here so the user can press "3" to bump
        // count then "F" if they want to pick friends, or "Enter" to
        // save a 3-way with no named friends.
        e.preventDefault();
        setShareCount(parseInt(e.key, 10));
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        applySuggested();
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setJustMe();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    save,
    onClose,
    onPrev,
    onNext,
    onPrevCategory,
    onNextCategory,
    onPrevMerchant,
    onNextMerchant,
    onActivePickerJump,
    applySuggested,
    setJustMe,
    toggleFriend,
    activePicker,
    pickerOpen,
    pickerIndex,
    activeList,
  ]);

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => b.txnCount - a.txnCount),
    [people],
  );

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          // Lighter overlay + stronger blur so the page behind the
          // modal stays visible as a frosted-glass texture, not a near-
          // black void. The queue rows behind read as silhouettes —
          // enough to remind the user where they are without competing
          // with the modal content. WebkitBackdropFilter mirrors
          // backdropFilter for Safari (which still gates the unprefixed
          // form behind a flag in some versions).
          background: "color-mix(in srgb, var(--bg) 38%, transparent)",
          backdropFilter: "blur(14px) saturate(120%)",
          WebkitBackdropFilter: "blur(14px) saturate(120%)",
        }}
      >
        <motion.div
          onClick={(e) => {
            e.stopPropagation();
            // Any click inside the modal shell (but outside the
            // picker — its own handler stops propagation) closes the
            // picker. Keeps the picker feeling like a transient
            // popover rather than a modal-within-a-modal.
            if (pickerOpen) setActivePicker(null);
          }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="surface"
          style={{
            width: "100%",
            // Modal grows when the detail pane is open so the form
            // doesn't shrink. 640 stays the form's width — the extra
            // 420 houses the detail pane drawer. Timing matches the
            // inner aside's width animation (320ms easeOutExpo) so
            // the shell and the drawer expand in lockstep.
            maxWidth: detailOpen ? 1060 : 640,
            maxHeight: "90vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
            transition: "max-width 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header */}
          <header
            style={{
              padding: "12px 22px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="eyebrow eyebrow-accent">Split · {positionIdx} of {positionTotal}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {fmtDate(row.txnDate)}
              {row.txnTime && (
                <>
                  {" · "}
                  <span className="mono tabular">{row.txnTime}</span>
                </>
              )}
              {" · "}
              {row.counterpartyKind ?? "txn"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm ghost" onClick={onPrev}>
              <Ico name="arrow-left" size={13} />
              <span className="kbd">←</span>
            </button>
            <button type="button" className="btn btn-sm ghost" onClick={onNext}>
              <Ico name="arrow-right" size={13} />
              <span className="kbd">→</span>
            </button>
            <button
              type="button"
              className="btn btn-sm ghost"
              aria-label="Close"
              onClick={onClose}
            >
              <Ico name="x" size={13} />
            </button>
          </header>

          {/* Category strip — group-by-category nav (jump prev/next,
              click to pick from list). Pulses accent when the
              category changes between rows so the user sees the
              transition. */}
          <NavStrip
            iconName="filter"
            groupLabel="category"
            groupName={category.name}
            positionInGroup={category.positionInCategory}
            totalInGroup={category.totalInCategory}
            navList={categoryNav}
            navIdx={categoryNavIdx}
            changed={categoryChanged}
            isPickerOpen={activePicker === "category"}
            onTogglePicker={() =>
              setActivePicker((cur) => (cur === "category" ? null : "category"))
            }
            onClosePicker={() => setActivePicker(null)}
            pickerIndex={pickerIndex}
            setPickerIndex={setPickerIndex}
            pickerListRef={pickerListRef}
            onPrev={onPrevCategory}
            onNext={onNextCategory}
            onJumpTo={onJumpToCategory}
            shortcutPrev="["
            shortcutNext="]"
            shortcutPick="C"
            pickerKeyPrefix="cat"
          />

          {/* Merchant strip — same UX as category, group dimension is
              counterparty. Lets the user walk merchant-by-merchant
              within a category, jump to "next merchant in queue",
              or pick a specific merchant from the dropdown. */}
          <NavStrip
            iconName="user"
            groupLabel="merchant"
            groupName={merchant.name}
            positionInGroup={merchant.positionInMerchant}
            totalInGroup={merchant.totalInMerchant}
            navList={merchantNav}
            navIdx={merchantNavIdx}
            changed={merchantChanged}
            isPickerOpen={activePicker === "merchant"}
            onTogglePicker={() =>
              setActivePicker((cur) => (cur === "merchant" ? null : "merchant"))
            }
            onClosePicker={() => setActivePicker(null)}
            pickerIndex={pickerIndex}
            setPickerIndex={setPickerIndex}
            pickerListRef={pickerListRef}
            onPrev={onPrevMerchant}
            onNext={onNextMerchant}
            onJumpTo={onJumpToMerchant}
            shortcutPrev="{"
            shortcutNext="}"
            shortcutPick="M"
            pickerKeyPrefix="merchant"
          />


          {/* Body — two-pane when detail is open. Left: existing form.
              Right: detail pane (raw narration, account, sources, etc). */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flex: detailOpen ? "0 0 640px" : "1 1 auto",
                overflowY: "auto",
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                minWidth: 0,
              }}
            >
            {/* Counterparty + amount — clickable to toggle the detail pane */}
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              aria-expanded={detailOpen}
              title={
                detailOpen
                  ? "Close transaction detail"
                  : "Click for raw bank narration, account, source info"
              }
              className="txn-header-clickable"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 10,
                padding: "8px 10px",
                margin: "-8px -10px",
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
                transition:
                  "background 180ms var(--ease-out), border-color 180ms var(--ease-out)",
              }}
            >
              <div
                className="flex items-center"
                style={{ gap: 8 }}
              >
                <h2
                  className="h1"
                  style={{ fontSize: 26, letterSpacing: "-0.01em", flex: 1, minWidth: 0 }}
                >
                  {row.counterparty}
                </h2>
                <Ico
                  name={detailOpen ? "chevron-right" : "more"}
                  size={14}
                  className="muted-2"
                />
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {row.category ?? "Uncategorized"}
                {row.recurrence && row.recurrence !== "one_time" && (
                  <>
                    {" · "}
                    <span className="accent">{row.recurrence}</span>
                  </>
                )}
              </div>
              <div
                className="num-amount"
                style={{
                  fontSize: 48,
                  marginTop: 14,
                  color:
                    row.direction === "debit"
                      ? "var(--debit)"
                      : "var(--credit)",
                }}
              >
                {row.direction === "debit" ? "−" : "+"}
                {fmtInr(row.amount)}
              </div>
            </button>

            {/* Suggested split (only when we have a person target + not already split) */}
            {row.suggestedSplitWith && !split && (
              <button
                type="button"
                onClick={applySuggested}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 14px",
                  background:
                    "linear-gradient(180deg, var(--accent-soft), transparent 100%)",
                  border: "1px solid var(--accent-line)",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  textAlign: "left",
                  transition: "filter 180ms ease",
                }}
              >
                <Ico name="sparkles" size={16} className="accent" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--fg)" }}>
                    Split <b style={{ fontWeight: 500 }}>2-way</b> with{" "}
                    <b style={{ fontWeight: 500, color: "var(--accent)" }}>
                      {row.suggestedSplitWith}
                    </b>
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    They&rsquo;ll owe you {fmtInr(row.amount / 2)}{" "}
                    (your half: {fmtInr(row.amount / 2)})
                  </div>
                </div>
                <span className="kbd">S</span>
              </button>
            )}

            {/* Friends picker */}
            <div>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
                <span className="eyebrow">Whose expense</span>
                {split && (
                  <span className="tag mono">
                    {ways}-way · {fmtInr(perPerson)} each
                  </span>
                )}
              </div>
              <div
                className="flex"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 3,
                  gap: 2,
                  marginBottom: 10,
                }}
              >
                <button
                  type="button"
                  onClick={setJustMe}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: !split ? "var(--surface)" : "transparent",
                    border: !split
                      ? "1px solid var(--border-strong)"
                      : "1px solid transparent",
                    borderRadius: 6,
                    color: !split ? "var(--fg)" : "var(--muted)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Just me <span className="kbd" style={{ marginLeft: 6 }}>J</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!split) {
                      // Default to suggested or first known person
                      const target =
                        row.suggestedSplitWith ??
                        sortedPeople[0]?.displayName;
                      if (target) {
                        setSharedWith([target]);
                        setShareCount(2);
                      }
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: split ? "var(--surface)" : "transparent",
                    border: split
                      ? "1px solid var(--border-strong)"
                      : "1px solid transparent",
                    borderRadius: 6,
                    color: split ? "var(--fg)" : "var(--muted)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Split with friends
                </button>
              </div>
              {split && (
                <>
                  {activePicker === "friend" && (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{
                        marginBottom: 6,
                        padding: "4px 8px",
                        background: "var(--accent-soft)",
                        border: "1px solid var(--accent-line)",
                        borderRadius: 6,
                        color: "var(--accent)",
                        fontSize: 11.5,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Ico name="users" size={11} />
                      <span style={{ flex: 1 }}>
                        Friend picker · <span className="kbd">↑</span>/<span className="kbd">↓</span> nav ·{" "}
                        <span className="kbd">↵</span> toggle ·{" "}
                        <span className="kbd">2</span>–<span className="kbd">9</span> way ·{" "}
                        <span className="kbd">Esc</span> close
                      </span>
                      <span className="mono tabular" style={{ color: "var(--accent)" }}>
                        {ways}-way · {sharedWith.length} named
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {sortedPeople.map((p, i) => {
                      const on = sharedWith.includes(p.displayName);
                      const isFocused =
                        activePicker === "friend" && i === pickerIndex;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleFriend(p.displayName)}
                          onMouseEnter={() => {
                            // Mirror category/merchant picker behavior:
                            // mouse hover moves the keyboard highlight
                            // so mouse + keyboard mix cleanly.
                            if (activePicker === "friend") setPickerIndex(i);
                          }}
                          className="chip"
                          style={{
                            background: on
                              ? "var(--accent-soft)"
                              : "transparent",
                            borderColor: on
                              ? "var(--accent-line)"
                              : "var(--border)",
                            color: on ? "var(--accent)" : "var(--fg-2)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            // Focus ring: a stronger accent outline
                            // around the keyboard-highlighted chip.
                            // Uses box-shadow so it sits outside the
                            // existing border without shifting layout.
                            boxShadow: isFocused
                              ? "0 0 0 2px var(--accent)"
                              : undefined,
                            outline: "none",
                            transition:
                              "box-shadow 140ms var(--ease-out), background 140ms var(--ease-out)",
                          }}
                        >
                          {on && <Ico name="check" size={11} />}
                          {p.displayName}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {split && row.direction === "debit" && (
                <div
                  className="small"
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    background: "var(--surface-2)",
                    border: "1px dashed var(--border)",
                    borderRadius: 7,
                    color: "var(--muted)",
                  }}
                >
                  You paid {fmtInr(row.amount)}; your share is{" "}
                  <b style={{ color: "var(--fg)", fontWeight: 500 }}>
                    {fmtInr(yourShare)}
                  </b>{" "}
                  · {sharedWith.length > 0 ? "they owe you" : "others owe you"}{" "}
                  <b
                    style={{ color: "var(--credit)", fontWeight: 500 }}
                  >
                    +{fmtInr(owedToYou)}
                  </b>
                </div>
              )}
            </div>

            {/* Bulk rule offer */}
            {otherCount > 0 && split && (
              <button
                type="button"
                onClick={() => setApplyRule((v) => !v)}
                aria-pressed={applyRule}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: applyRule
                    ? "var(--accent-soft)"
                    : "var(--surface-2)",
                  border: `1px solid ${
                    applyRule ? "var(--accent-line)" : "var(--border)"
                  }`,
                  borderRadius: 8,
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 4,
                    border: `1.5px solid ${
                      applyRule ? "var(--accent)" : "var(--border-strong)"
                    }`,
                    background: applyRule ? "var(--accent)" : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: "var(--accent-ink)",
                  }}
                >
                  {applyRule && <Ico name="check" size={10} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  Save this as a rule —{" "}
                  applies to <b style={{ fontWeight: 500 }}>{otherCount}</b>{" "}
                  other un-reviewed{" "}
                  <b style={{ fontWeight: 500 }}>
                    “{row.counterparty}”
                  </b>{" "}
                  txn{otherCount === 1 ? "" : "s"} and every future one
                </span>
                <Ico name="sparkles" size={13} className="accent" />
              </button>
            )}

            {err && (
              <div
                className="small"
                style={{ color: "var(--warn)" }}
              >
                {err}
              </div>
            )}
            </div>

            {/* Right pane — detail. Animates its own width on
                enter/exit so the reveal feels like a drawer sliding
                out from the modal's right edge, not a fade.
                AnimatePresence is what allows the exit animation to
                fire when detailOpen flips back to false. */}
            <AnimatePresence initial={false}>
              {detailOpen && (
                <motion.aside
                  key="detail-pane"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 420, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    width: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
                    opacity: {
                      duration: 0.2,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.04,
                    },
                  }}
                  style={{
                    flex: "0 0 auto",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--border)",
                    background: "var(--surface-2)",
                  }}
                >
                  <motion.div
                    initial={{ x: 24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 24, opacity: 0 }}
                    transition={{
                      duration: 0.26,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.06,
                    }}
                    style={{
                      width: 420,
                      height: "100%",
                      overflowY: "auto",
                      padding: "18px 22px",
                    }}
                  >
                    <DetailPane
                      row={row}
                      detail={detail}
                      recall={recall}
                      loading={detailLoading}
                      onClose={() => setDetailOpen(false)}
                    />
                  </motion.div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <footer
            style={{
              padding: "12px 22px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="tiny muted" style={{ flex: 1 }}>
              {pickerOpen ? (
                activePicker === "friend" ? (
                  <>
                    <span className="kbd">↑</span>/<span className="kbd">↓</span> nav ·{" "}
                    <span className="kbd">↵</span> toggle ·{" "}
                    <span className="kbd">2</span>–<span className="kbd">9</span> way ·{" "}
                    <span className="kbd">C</span>/<span className="kbd">M</span>/<span className="kbd">F</span> swap ·{" "}
                    <span className="kbd">Esc</span> close
                  </>
                ) : (
                  <>
                    <span className="kbd">↑</span>/<span className="kbd">↓</span> highlight ·{" "}
                    <span className="kbd">↵</span> jump ·{" "}
                    <span className="kbd">C</span>/<span className="kbd">M</span>/<span className="kbd">F</span> swap ·{" "}
                    <span className="kbd">Esc</span> close picker
                  </>
                )
              ) : (
                <>
                  <span className="kbd">↵</span> save ·{" "}
                  <span className="kbd">S</span> suggest ·{" "}
                  <span className="kbd">J</span> just me ·{" "}
                  <span className="kbd">F</span> friends ·{" "}
                  <span className="kbd">2</span>–<span className="kbd">9</span> way ·{" "}
                  <span className="kbd">Space</span> detail ·{" "}
                  <span className="kbd">[</span>/<span className="kbd">]</span> cat ·{" "}
                  <span className="kbd">&#123;</span>/<span className="kbd">&#125;</span> merch ·{" "}
                  <span className="kbd">Esc</span> close
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-sm ghost"
              onClick={onNext}
              disabled={saving}
            >
              Skip
            </button>
            <button
              type="button"
              className="btn btn-sm primary"
              onClick={() => save(true)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save & Next"}{" "}
              <span className="kbd kbd-on-accent">↵</span>
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * NavStrip — group-nav row rendered inside the modal header.
 * Used for both the category and the merchant dimensions. Renders:
 *
 *   [icon] [<] [GROUP NAME ▾] [>]    N of M in this <label>  [progress]
 *                ▼ (picker popover, when open)
 *
 * Two strip instances share the same `pickerIndex` and `pickerListRef`
 * upstream — they're mutually exclusive (only one can be the active
 * picker at a time), so a single set of picker state is enough.
 * The component itself is presentational; the parent decides which
 * strip is "the active picker" via `isPickerOpen`.
 */
function NavStrip({
  iconName,
  groupLabel,
  groupName,
  positionInGroup,
  totalInGroup,
  navList,
  navIdx,
  changed,
  isPickerOpen,
  onTogglePicker,
  onClosePicker,
  pickerIndex,
  setPickerIndex,
  pickerListRef,
  onPrev,
  onNext,
  onJumpTo,
  shortcutPrev,
  shortcutNext,
  shortcutPick,
  pickerKeyPrefix,
}: {
  iconName: "filter" | "user";
  /** Display word for the group dimension, e.g. "category" or
   *  "merchant". Used in the "N of M in this <label>" caption and
   *  in the picker's empty-state copy. */
  groupLabel: string;
  groupName: string;
  positionInGroup: number;
  totalInGroup: number;
  navList: NavEntry[];
  navIdx: number;
  /** Pulse the strip background when the group value changed
   *  between consecutive txns (separate per strip — category
   *  changes less often than merchant). */
  changed: boolean;
  isPickerOpen: boolean;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  pickerIndex: number;
  setPickerIndex: (i: number) => void;
  /** Ref attached to the picker `<motion.div>` only when this strip's
   *  picker is the active one — so scroll-into-view in the parent
   *  targets the correct list. */
  pickerListRef: React.MutableRefObject<HTMLDivElement | null>;
  onPrev: () => void;
  onNext: () => void;
  onJumpTo: (name: string) => void;
  shortcutPrev: string;
  shortcutNext: string;
  shortcutPick: string;
  /** Unique-per-strip prefix for picker option IDs (so the merchant
   *  picker doesn't collide with the category picker). */
  pickerKeyPrefix: string;
}) {
  const atFirst = navIdx <= 0;
  const atLast = navIdx < 0 || navIdx >= navList.length - 1;
  return (
    <div
      style={{
        padding: "10px 22px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: changed ? "var(--accent-soft)" : "var(--surface-2)",
        transition: "background 600ms var(--ease-out-expo)",
        position: "relative",
      }}
    >
      <Ico
        name={iconName}
        size={13}
        className={changed ? "accent" : "muted"}
      />
      <button
        type="button"
        onClick={onPrev}
        disabled={atFirst}
        title={`Previous ${groupLabel} (${shortcutPrev})`}
        aria-label={`Previous ${groupLabel}`}
        className="btn btn-sm ghost"
        style={{ padding: "2px 5px", opacity: atFirst ? 0.35 : 1 }}
      >
        <Ico name="chevron-left" size={11} />
      </button>
      <button
        type="button"
        onClick={onTogglePicker}
        aria-expanded={isPickerOpen}
        aria-haspopup="listbox"
        title={`Jump to ${groupLabel} (${shortcutPick})`}
        className="eyebrow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          maxWidth: 280,
          background: isPickerOpen ? "var(--surface)" : "transparent",
          border: `1px solid ${
            isPickerOpen ? "var(--border-strong)" : "transparent"
          }`,
          borderRadius: 6,
          color: changed ? "var(--accent)" : "var(--muted)",
          fontFamily: "inherit",
          fontSize: 11,
          letterSpacing: "0.05em",
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          transition:
            "color 600ms var(--ease-out-expo), background 140ms var(--ease-out), border-color 140ms var(--ease-out)",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {groupName}
        </span>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            transform: isPickerOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 180ms var(--ease-out)",
          }}
        >
          <Ico name="chevron-down" size={10} />
        </span>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={atLast}
        title={`Next ${groupLabel} (${shortcutNext})`}
        aria-label={`Next ${groupLabel}`}
        className="btn btn-sm ghost"
        style={{ padding: "2px 5px", opacity: atLast ? 0.35 : 1 }}
      >
        <Ico name="chevron-right" size={11} />
      </button>
      <span
        className="mono tabular"
        style={{
          fontSize: 11.5,
          color: "var(--muted-2)",
          marginLeft: "auto",
        }}
      >
        {positionInGroup} of {totalInGroup} in this {groupLabel}
      </span>
      <div
        aria-hidden
        style={{
          width: 80,
          height: 3,
          background: "var(--surface-3)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${
              totalInGroup > 0 ? (positionInGroup / totalInGroup) * 100 : 0
            }%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 220ms var(--ease-out)",
          }}
        />
      </div>

      <AnimatePresence>
        {isPickerOpen && (
          <motion.div
            key={`${pickerKeyPrefix}-picker`}
            ref={pickerListRef}
            role="listbox"
            aria-label={`Jump to ${groupLabel}`}
            aria-activedescendant={
              navList[pickerIndex]
                ? `${pickerKeyPrefix}-opt-${pickerIndex}`
                : undefined
            }
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 40,
              zIndex: 5,
              minWidth: 280,
              maxWidth: 360,
              maxHeight: 320,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: 10,
              boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
              padding: 4,
            }}
          >
            {navList.length === 0 && (
              <div className="small muted" style={{ padding: 10 }}>
                No {groupLabel}s in this queue.
              </div>
            )}
            {/* Two states per row:
                 isCurrent — the row's actual group (check + bold)
                 isHighlighted — where ↑/↓ has the keyboard focus
                   right now (accent-soft background).
                 Splitting them keeps the "you are here" anchor stable
                 while the keyboard highlight roams. */}
            {navList.map((c, i) => {
              const isCurrent = i === navIdx;
              const isHighlighted = i === pickerIndex;
              return (
                <button
                  key={c.name}
                  id={`${pickerKeyPrefix}-opt-${i}`}
                  data-picker-idx={i}
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseEnter={() => setPickerIndex(i)}
                  onClick={() => {
                    onJumpTo(c.name);
                    onClosePicker();
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "14px 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    width: "100%",
                    padding: "8px 10px",
                    background: isHighlighted
                      ? "var(--accent-soft)"
                      : "transparent",
                    border: `1px solid ${
                      isHighlighted ? "var(--accent-line)" : "transparent"
                    }`,
                    borderRadius: 6,
                    color: isHighlighted ? "var(--accent)" : "var(--fg)",
                    fontWeight: isCurrent ? 500 : 400,
                    fontFamily: "inherit",
                    fontSize: 13,
                    textAlign: "left",
                    cursor: "pointer",
                    transition:
                      "background 100ms var(--ease-out), border-color 100ms var(--ease-out)",
                  }}
                >
                  <span aria-hidden>
                    {isCurrent && (
                      <Ico
                        name="check"
                        size={11}
                        className={isHighlighted ? "" : "accent"}
                      />
                    )}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    className="mono tabular tiny"
                    style={{
                      color: isHighlighted
                        ? "var(--accent)"
                        : "var(--muted-2)",
                    }}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/**
 * Format the "when" line for the detail pane. Combines:
 *   - day of week ("Fri")
 *   - date ("25 Apr 2026")
 *   - clock time when present ("14:32")
 *   - a light period-of-day hint when time is present ("afternoon",
 *     "late night") so the user gets a memory anchor even when they
 *     don't recognize the exact minute.
 */
function fmtWhen(iso: string, time: string | null): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dow = days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  const datePart = `${dow} · ${d} ${months[m - 1]} ${y}`;
  if (!time) return `${datePart}  · no clock time`;
  return `${datePart} · ${time} ${periodOfDay(time)}`;
}

function periodOfDay(time: string): string {
  const hh = parseInt(time.slice(0, 2), 10);
  if (Number.isNaN(hh)) return "";
  if (hh >= 5 && hh < 12) return "(morning)";
  if (hh >= 12 && hh < 17) return "(afternoon)";
  if (hh >= 17 && hh < 21) return "(evening)";
  return "(late night)";
}

/**
 * Map the internal counterparty_kind enum to a human-readable label.
 * The DB stores parser-derived tags (named / vpa / bill / etc.) that
 * are meaningful to ingestion code but jargon to a user reading the
 * detail pane.
 */
function humanCounterpartyKind(kind: string | null): string {
  switch (kind) {
    case "named":
      return "Identified business";
    case "vpa":
      return "Unknown UPI address";
    case "person":
      return "Personal contact";
    case "bill":
      return "Bill payment";
    case "self_transfer":
      return "Self-transfer";
    case "unknown":
      return "Unidentified";
    default:
      return kind ?? "Unknown";
  }
}

/** Human label for the days-elapsed between txn date and value date. */
function dayGapLabel(txnDate: string, valueDate: string): string {
  const a = new Date(txnDate + "T00:00:00Z").getTime();
  const b = new Date(valueDate + "T00:00:00Z").getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days === 0) return "same day";
  if (days === 1) return "1 day later";
  if (days > 1) return `${days} days later`;
  if (days === -1) return "1 day earlier";
  return `${Math.abs(days)} days earlier`;
}

/**
 * Side detail pane — opens when the user clicks the txn header card
 * in SplitTxnModal. Surfaces the things the user can't infer from
 * the headline alone but commonly wants while deciding "should I
 * split this":
 *
 *   - Raw bank narration (the verbatim string before normalization)
 *   - UTR / ref no for cross-checking with bank/UPI app
 *   - Account this debit came from (bank + last4)
 *   - Source extractors that observed this txn (which kind of
 *     statement / email / OCR contributed)
 *   - Counterparty kind (person / vpa / bill / named)
 *   - Notes the user previously left
 *   - Attached files (Zepto invoice PDFs, OCR'd receipts, etc.)
 *
 * Lazily-fetched: SplitTxnModal calls getTransactionDetailForSplit
 * on first open. Shows a loading state while the fetch is in flight.
 */
function DetailPane({
  row,
  detail,
  recall,
  loading,
  onClose,
}: {
  row: SplitQueueRow;
  detail: ReviewTransactionDetail | null;
  recall: MerchantRecallContext | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ico name="more" size={14} className="muted" />
        <span className="eyebrow" style={{ flex: 1 }}>
          Transaction detail
        </span>
        <button
          type="button"
          className="btn btn-sm ghost"
          onClick={onClose}
          aria-label="Close detail pane"
          style={{ padding: "2px 8px" }}
        >
          <Ico name="x" size={12} />
        </button>
      </header>

      {loading && (
        <div className="small muted">Loading…</div>
      )}

      {!loading && !detail && (
        <div className="small muted">
          Couldn&rsquo;t fetch detail. The txn may have been removed.
        </div>
      )}

      {detail && (
        <>
          {/* When — leads the pane because the user's first
              recall question is "when did this happen?". Day-of-week
              + date + clock time give the strongest memory hook,
              especially for txns without a useful bank narration. */}
          <Field label="When">
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              {fmtWhen(detail.txnDate, detail.txnTime)}
            </span>
            {detail.valueDate && detail.valueDate !== detail.txnDate && (
              <span
                className="tiny"
                style={{
                  color: "var(--muted-2)",
                  display: "block",
                  marginTop: 3,
                }}
              >
                Value date: {fmtDate(detail.valueDate)} (settled{" "}
                {dayGapLabel(detail.txnDate, detail.valueDate)})
              </span>
            )}
          </Field>

          {/* Cadence chip — only when detection produced a result.
              Helps the user recognize "oh yeah, this is the monthly
              Apple charge" at a glance, without scanning the recent
              history below for the pattern manually. */}
          {recall?.cadence && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
                borderRadius: 999,
                fontSize: 11.5,
                color: "var(--accent)",
                width: "fit-content",
              }}
            >
              <Ico name="repeat" size={11} />
              {recall.cadence} subscription detected
            </div>
          )}

          {/* Recent history at this merchant — the highest-ROI memory
              hook in the pane. Shows the last few charges, lifetime
              total, and typical amount. If the current amount is
              unusual vs typical, calls it out. */}
          {recall && recall.lifetimeCount > 0 && (
            <Field
              label={`Recent at this merchant · ${recall.lifetimeCount.toLocaleString()} lifetime`}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginTop: 2,
                }}
              >
                {recall.recent.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      padding: "3px 0",
                      fontSize: 12,
                      borderBottom: "1px dashed var(--border-dashed)",
                    }}
                  >
                    <span
                      className="mono"
                      style={{ color: "var(--muted)" }}
                    >
                      {fmtDate(r.txnDate)}
                      {r.txnTime && (
                        <span
                          style={{
                            color: "var(--muted-2)",
                            marginLeft: 6,
                          }}
                        >
                          {r.txnTime}
                        </span>
                      )}
                    </span>
                    <span
                      className="tabular"
                      style={{
                        color:
                          r.direction === "debit"
                            ? "var(--debit)"
                            : "var(--credit)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.direction === "debit" ? "−" : "+"}
                      {fmtInr(r.amount)}
                    </span>
                  </div>
                ))}
              </div>
              {recall.typicalAmount > 0 && (
                <div
                  className="tiny"
                  style={{
                    color: "var(--muted-2)",
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  typical {fmtInr(recall.typicalAmount)} · this charge{" "}
                  {recall.isUnusualAmount ? (
                    <span
                      style={{
                        color: "var(--warn)",
                        padding: "1px 6px",
                        borderRadius: 4,
                        background:
                          "color-mix(in srgb, var(--warn) 12%, transparent)",
                        border:
                          "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                      }}
                    >
                      ⚠ unusual{" "}
                      {recall.typicalAmount > 0
                        ? `(${(row.amount / recall.typicalAmount).toFixed(1)}× typical)`
                        : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--credit)" }}>
                      ✓ typical
                    </span>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Bank narration: hidden when empty. For PhonePe-only
              sources we never get a bank narration; showing "—"
              just adds noise the user has to skip past. */}
          {detail.narration && detail.narration.trim() !== "" && (
            <Field label="Bank narration">
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--fg-2)",
                  wordBreak: "break-word",
                }}
              >
                {detail.narration}
              </span>
            </Field>
          )}

          <Field label="From account">
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              {detail.account.bank} {detail.account.type}
            </span>
            <span
              className="mono"
              style={{
                marginLeft: 6,
                fontSize: 12,
                color: "var(--muted-2)",
              }}
            >
              ···{detail.account.last4}
            </span>
          </Field>

          {detail.refNo && (
            <Field label="UTR / Ref">
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--fg-2)" }}
              >
                {detail.refNo}
              </span>
            </Field>
          )}

          <Field label="Counterparty kind">
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>
              {humanCounterpartyKind(detail.counterpartyKind)}
              {detail.personId && (
                <span style={{ color: "var(--muted-2)", marginLeft: 6 }}>
                  · person id <span className="mono">{detail.personId}</span>
                </span>
              )}
            </span>
          </Field>

          {detail.sources.length > 0 && (
            <Field label={`Sources · ${detail.sources.length}`}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 5,
                  marginTop: 4,
                }}
              >
                {detail.sources.map((s, i) => (
                  <span
                    key={`${s.sourceType}-${i}`}
                    className="chip chip-sm"
                    style={{
                      fontSize: 11,
                      background: "var(--surface)",
                      borderColor: "var(--border)",
                      color: "var(--fg-2)",
                    }}
                  >
                    {s.sourceType}
                  </span>
                ))}
              </div>
            </Field>
          )}

          {detail.attachedFiles.length > 0 && (
            <Field label={`Attached · ${detail.attachedFiles.length}`}>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {detail.attachedFiles.map((f, i) => (
                  <span
                    key={`${f.sourceType}-${i}`}
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      wordBreak: "break-all",
                    }}
                  >
                    <Ico name="paperclip" size={11} /> {f.path.split("/").pop()}
                  </span>
                ))}
              </div>
            </Field>
          )}

          {detail.notes && (
            <Field label="Notes">
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--fg-2)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {detail.notes}
              </span>
            </Field>
          )}

          {detail.inferredLocation && (
            <Field label="Inferred location">
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--fg-2)",
                }}
              >
                {detail.inferredLocation.placeName ?? "—"}
                {detail.inferredLocation.placeCategory && (
                  <span style={{ color: "var(--muted-2)", marginLeft: 6 }}>
                    · {detail.inferredLocation.placeCategory}
                  </span>
                )}
              </span>
            </Field>
          )}

          {row.personId && detail.counterpartyKind === "person" && (
            <a
              href={`/friends/${row.personId}`}
              className="btn btn-sm outline"
              style={{ marginTop: 6, justifyContent: "center" }}
            >
              <Ico name="users" size={13} /> Open Friends ledger
            </a>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        className="eyebrow"
        style={{ fontSize: 10.5, letterSpacing: "0.05em" }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
