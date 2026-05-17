# WIP archive

Patches that were never landed on `main`, kept here as design references for
future work. Each file is the raw `git stash show -p` output of an abandoned
WIP. They will NOT apply cleanly against `main` — they exist to document intent,
not to be replayed verbatim.

## Files

### `dreamy-hopper-upload-queue.patch.diff`

**Origin:** `stash@{0}` on the deleted `claude/dreamy-hopper-cb970d` branch
(2026-05-17, pre-consolidation).

**What it tried to do.** Refactor `/try` from a single-file upload flow into a
multi-file upload queue:

- Shrink `apps/web/src/app/try/page.tsx` from ~342 lines to ~61 lines — the
  page becomes a thin shell that just renders `<PdfDropzone>` + `<UploadQueue>`.
- Move all parse/save logic, password handling, and result display into a new
  `UploadQueue` component that processes dropped files in sequence, auto-tries
  any passwords already unlocked this session, and only prompts when it truly
  can't get in.
- Adjust `PdfDropzone` to support drop-anywhere (window-level) and surface
  state through callbacks instead of owning the parse pipeline itself.

**Why it's archived, not merged.** The stash was created from a working tree
that also had an uncommitted `apps/web/src/components/UploadQueue.tsx` file
which was never stashed. The dreamy-hopper branch was deleted before the
component was committed. The stash references `@/components/UploadQueue` but
that module does not exist in any commit, branch, or stash that survived. The
patch cannot apply against today's `main` either — `/try/page.tsx` and
`PdfDropzone.tsx` were rewritten by the review-page redesign (`4d74f13`).

**To rebuild this feature later:** treat the patch as a sketch of the desired
shape. The actual `UploadQueue.tsx` needs to be written fresh against the
current `repo.ts` (which is also different from when this was drafted).
