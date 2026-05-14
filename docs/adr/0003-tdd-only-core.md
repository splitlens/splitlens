# ADR-0003: TDD only the core, not React components

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Prateek Aryan

## Context

Founder requested test-driven development for the rewrite. TDD is unequivocally good for some code and unequivocally harmful for other code. Need to be specific about scope.

## Decision

TDD applies to:
- ✅ `packages/core` — parsers, rules engine, settlement math, encryption, type-safe utilities
- ✅ Database schema migrations (integration tests with PGlite in-memory)

TDD does NOT apply to:
- ❌ React components (use Storybook + visual regression instead)
- ❌ Next.js pages (use Playwright E2E for critical paths)
- ❌ Animations or CSS (visual snapshots only)
- ❌ shadcn/ui primitives (already battle-tested upstream)
- ❌ Trivial wrappers around well-tested libraries

## Rationale

### Where TDD shines (and why we use it for core)
- Pure functions with deterministic inputs and outputs
- Bugs are expensive (off-by-one rupee = settlement is wrong = trust shattered)
- Refactors are common (we'll port the parser logic, then improve it 10 times)
- Test fixtures (sample PDFs) become a community asset for adding new bank parsers

### Where TDD hurts (and why we don't use it for UI)
- Tests assert implementation details (DOM structure, prop signatures) that change with every refactor
- "Does the button render" tests provide false confidence and rot fast
- Mocking React Query / Drizzle / DOM events to "unit test" a component is more code than the component itself
- Visual regression catches what TDD can't (alignment, color, contrast)

## What this means in practice

`packages/core/tests/` will have heavy coverage (>90%) and will be the source of truth for parser correctness.

`apps/web/` will have:
- Storybook stories for every component (catches visual regressions)
- Playwright tests for the 5 critical user paths
- Lighthouse CI gates on every PR

We will NOT have a `apps/web/__tests__/` folder full of `Button.test.tsx`. If you find yourself writing one, stop — move that logic to `packages/core` and test it there.
