# ADR-0005: License — AGPL-3.0 for the entire repository

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Prateek Aryan
**Supersedes:** the license clause in ADR-0002 (which originally proposed AGPL core + proprietary UI)

## Context

Founder decided to make SplitLens **fully open source**. Earlier proposal was a split license (AGPL for `packages/core`, proprietary for `apps/web`) to retain commercial leverage on the UI/marketing layer. Founder rejected the split — wants a single, consistent open-source posture.

Need to pick the right OSS license for a privacy-first, local-first product that wants to:
- Encourage community contributions (especially bank parsers for ICICI, Axis, SBI, etc.)
- Prevent a competitor from forking and shipping a closed-source SaaS clone
- Signal trust ("you can read every line of code that touches your data")
- Allow founder to pursue future commercial paths (paid sync tier, hosted edition, B2B licenses) without conflict

## Decision

**The entire SplitLens repository is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).**

This applies to:
- `packages/core` (parsers, rules, settlement, encryption)
- `packages/db` (schema)
- `apps/web` (the entire Next.js application, components, styles)
- All assets, configuration, and tooling in the repo

## Why AGPL-3.0 (not MIT, Apache 2.0, GPL-3.0, or BSL)

| License | Verdict | Why |
|---|---|---|
| **MIT** | ❌ Rejected | Anyone can fork SplitLens, slap a paid plan on it, and ship as SaaS without contributing back. Defeats the whole point. |
| **Apache 2.0** | ❌ Rejected | Same problem as MIT. Patent grant is nice but doesn't solve the SaaS-fork issue. |
| **GPL-3.0** | ⚠️ Close | Strong copyleft for distributed binaries. But: if someone forks SplitLens, hosts it as SaaS (without distributing the binary), they aren't required to share their changes. AGPL closes this loophole. |
| **AGPL-3.0** | ✅ **Chosen** | GPL-3.0 + Section 13: if you provide network-accessible service, source must be available to users. Future-proofs against SaaS forks. |
| **BSL (Business Source License)** | ❌ Rejected | "Open source after 4 years" — founder rejected; wants pure OSS now. |
| **Source-available (Sentry-style)** | ❌ Rejected | Same — founder rejected non-OSI licenses. |
| **Elastic License v2** | ❌ Rejected | Not OSI-approved. Can't claim "open source" cleanly. |

## What AGPL-3.0 means in practice

**For users (anyone running SplitLens):**
- Free to use for any purpose, personal or commercial
- Free to inspect the code (and audit the privacy claim)
- Free to modify for personal use
- Free to redistribute the original or modified version, provided derivatives are also AGPL-3.0

**For contributors:**
- Contributions are accepted under AGPL-3.0 + an inbound CLA (Contributor License Agreement) granting Prateek the right to dual-license SplitLens commercially in the future. (CLA terms TBD; open question.)

**For competitors:**
- Can fork SplitLens. **Must** open-source any changes if they distribute or host.
- A SaaS competitor running modified SplitLens must publish their source under AGPL-3.0. Effectively prevents proprietary clones.

**For founder (commercial paths):**
- Can sell support, hosting, training, consulting on SplitLens.
- Can offer a "SplitLens Cloud" hosted edition under AGPL-3.0 (source still public).
- Can dual-license to enterprises that don't want AGPL contagion (requires the CLA from contributors).

## Companies using AGPL-3.0 in similar privacy/local-first space

- **Mastodon** — privacy-first social
- **Plausible Analytics** — privacy-first analytics (built a sustainable business on AGPL)
- **Standard Notes** — encrypted notes (B2C SaaS model with AGPL core)
- **Matrix.org / Element** — encrypted messaging
- **Nextcloud** — self-hosted file storage
- **Bitwarden** — password manager (AGPL with paid hosted tier)

These all demonstrate that **AGPL ≠ no business model**. The opposite — privacy-first products often *require* AGPL to credibly differentiate.

## CLA decision (open)

Three options:
1. **No CLA** — contributors retain copyright of their changes. Cleanest, most welcoming. Risk: cannot dual-license without re-licensing every contribution (intractable past ~50 contributors).
2. **Inbound = Outbound (Apache-style)** — contributors agree their code is licensed under AGPL-3.0 to the project. Same as no-CLA in practice.
3. **Sign a CLA** — contributors grant copyright assignment OR a broad license to SplitLens to relicense. Allows future dual-licensing. Friction: scares some contributors.

**Recommendation:** Start with option 1 (no CLA). Revisit when first enterprise customer asks for non-AGPL terms.

## License header for new files

Every source file should begin with:

```
// SplitLens — Local-first personal finance for Indian banks
// Copyright (C) 2026 Prateek Aryan and SplitLens contributors
// SPDX-License-Identifier: AGPL-3.0-only
```

Auto-enforced via ESLint plugin `eslint-plugin-license-header`.

## Re-evaluation triggers

Revisit if:
- An enterprise customer wants commercial dual-license AND we have a CLA in place
- Community pressure for a more permissive license (unlikely; AGPL is generally welcomed in privacy-first space)
- AGPL is found to be incompatible with a critical dependency (very unlikely; we control the stack picks)
