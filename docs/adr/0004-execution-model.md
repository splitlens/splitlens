# ADR-0004: Execution model — single executor, milestone reviews

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Prateek Aryan

## Context

Founder suggested using "10 parallel agents" or a PM/CTO/dev sub-agent pattern for development. Need to be honest about what works and what doesn't.

## Decision

**Single-threaded execution**, with the following principles:

1. **One executor (Claude in interactive session) implements feature work**, end-to-end per feature.
2. **Founder reviews at milestones** — typically end of each Roadmap week.
3. **Sub-agents (`Agent` tool) are used for**:
   - Independent research tasks (evaluate library X, audit dependency Y)
   - Codebase exploration ("find all places that touch the rules engine")
   - Document generation that doesn't share state with current work
4. **Sub-agents are NOT used for**:
   - Writing code in the same files in parallel (merge hell)
   - "Pretending" to be PM / CTO / dev — that's just role-play with extra tokens

## Rationale

### Why parallel agents fail for greenfield product

- Two agents writing different components in the same repo will produce inconsistent patterns (different state libraries, different naming, different file structures)
- TDD has an inherent sequence (red → green → refactor) that doesn't parallelize
- Coordination overhead between sub-agents (sharing types, conventions, decisions) consumes more time than it saves
- Founder is the actual product owner and final arbiter — sub-agents pretending to be PM/CTO add noise without authority

### Why parallel agents work for some things

- Reading 200 files to find a pattern: parallelize across multiple `Explore` agents
- Evaluating "is library X better than Y" while you build with library Z: kick off in background
- Generating throwaway artifacts (boilerplate, test fixtures): parallel is fine

## Founder's role at each milestone

End of each Roadmap week, founder:
1. Pulls latest, runs `pnpm dev`
2. Validates the vertical slice works end-to-end
3. Provides feedback on UX (the only thing the founder can validate that I cannot)
4. Approves moving to next week's slice OR sends back for changes

This is the only sustainable pace for a high-quality product.
