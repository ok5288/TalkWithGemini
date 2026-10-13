# Intelligent UI optimization implementation

## Approved scope and acceptance

Implement the DEEIX-Chat comparison plan against the existing Intelligent UI
instance, source authorization and content projection modules. Keep the unified
fence, HTML SDK, provider contracts and tool authorization flow. No automatic
model repair, arbitrary formula language, deployment, commit or size budget gate.

### A — Runtime feedback and generation diagnostics

- Show receiving, starting, interactive and failed states without executing
  incomplete content. Preserve the existing scriptless HTML preview.
- Preserve controlled diagnostic codes for incomplete content, invalid JSON,
  invalid fields, unsupported versions/kinds and rejected HTML. Never display
  raw private field values or runtime stacks in the host.
- Validate with protocol, compatibility, card and runtime tests.

### B — Persistent viewing

- Place a desktop pane / narrow-screen expanded view outside the virtual
  timeline. Read the authoritative block rather than copying its state.
- Coordinate one interactive owner per block. Flush and save, release the old
  owner, then mount the replacement. Reject stale transitions and proposals.
- Block view changes while an import preview is unconfirmed. Preserve the
  current owner on save failure; cancel on authority/identity changes.
- Validate rapid transitions, virtual scrolling, layout changes, save failures,
  source revocation and teardown through host/store integration tests.

### C — Explicit host actions

- Explain and modify valid interfaces through editable composer proposals;
  repair failed content only when its original fence is uniquely identifiable.
- Centralize proposal lifetime without changing normal chat dispatch or SDK
  authorization. A revision is a new complete definition, never a partial patch.
- Validate edited drafts, preserved attachments, frozen context, cancellation,
  dispatch reauthorization, failures and accepted-message receipts.

### Explorer v2 — Bounded presentation composition

- After phase A/B/C acceptance, add v2 explorer definitions with finite sections,
  multiple charts and existing derived-state notices. Reuse one dataset, graph,
  selection and derive result; preserve v1 output and calculation semantics.
- Preserve the outer storage version. Old clients quarantine v2 and cannot sync
  affected data. New clients recover only fully validated known v2 payloads,
  revalidate state and resolve live source access again.
- Validate linked chart mappings, import/filter/sort consistency, private public
  projections, v1 regression and private-backup quarantine recovery. Test sync
  refusal separately from recovery; never promise mixed-version sync.

## Integration verification

Run targeted Vitest checks per increment, then imports, formatting, artifact
hygiene, lint, typecheck, all Vitest, Playwright E2E and production build. Add the
Worker build for runtime/environment changes. Browser fixtures must not call
real providers. Record results and limits below, and stop task-owned processes.

## Evidence

### A acceptance

- Controlled protocol diagnostics survive private normalization; arbitrary
  diagnostic text is discarded and never included in public projections.
- The host displays HTML starting/active/failure status, native receiving
  placeholders and safe policy rejection messages. Existing saved-state retry
  and scriptless preview behavior remain covered.
- Targeted verification: 5 Vitest files / 52 tests passed; TypeScript passed.

### B/C acceptance

- A display grant separates paused user interaction from authorized flush
  updates. The old transport is explicitly disposed before its replacement;
  each replacement gets a new runtime epoch. The viewer lives outside the
  virtual timeline and changes responsive layout without relocating its iframe.
- Host explain/modify/repair actions share the existing editable-composer
  proposal flow. Repair requires a unique original parser identity and source;
  copied, ambiguous, quarantined or mismatched content is not guessed.
- Sender regression tests include revocation after flushing and after message
  acceptance, plus quarantine added while a repair draft is pending.
- Chromium acceptance: all 4 new browser fixtures passed. They cover immediate
  last-value flush and restore, narrow-screen runtime preservation, draft text
  and frozen visible-result context with manual send, safe repair and explicit
  import cancellation. A mobile-viewer screenshot is attached to test output.
- Browser fixtures intercept chat requests and use synthetic data only.

### Explorer v2 implementation contract

Keep v1 definitions and default projections unchanged. V2 shares the existing
dataset, parameters, nodes and filters, with an ordered `sections` list:
parameters, metrics (node IDs), table, chart (stable ID/title/type/x/y), notices.
Require a table and, when parameters exist, their controls. Singleton sections
cannot repeat; up to four charts share one derive result. Charts reference known
columns or row calculations; conditions are existing derived statuses only.
The host controls responsive layout; v2 rejects unsupported layout fields.

Known v2 quarantine recovery accepts either an original full block or the
definition-only payload retained by old parsers. It parses once, validates all
supported structure and preserves the current wrapper's identity. Nested or
unknown quarantine stays inert. Restored bindings need live authorization.
Sync capture must recover known v2 in unopened local sessions before producing
both export data and CRDT documents; changing only the unsupported-content
guard would not recover the actual data and is forbidden.

### Explorer v2 acceptance

- Strict finite sections and multiple charts share one computation result and
  chart-specific row maps. Existing v1 definitions and projections remain covered.
- Static-current charts honor selected rows and visible columns; notices reuse
  the existing metric explanations and cannot hide required errors.
- Recovery parses only supported quarantine envelopes and real message blocks,
  leaving arbitrary tool-result data untouched. Deep/corrupt/unknown quarantine
  remains inert. Valid bindings survive as unverified identities.
- Unopened object and JSON-string session trees recover before sync documents
  are produced. Sync apply recovers local data before overlay so it cannot
  reintroduce the old quarantine marker. Unknown content still blocks upload.
- Targeted v2 verification: 10 files / 117 tests passed, TypeScript and scoped
  ESLint passed. Sol reviewed the recovery, source and projection seams.
- All 6 Intelligent UI Chromium fixtures passed, including a source-backed
  viewer's complete manual-send flow and v2 parameter/metric/multi-chart linkage.

## Final integrated verification — 2026-10-14

| Check                  | Result                                             |
| ---------------------- | -------------------------------------------------- |
| `check:imports`        | Passed                                             |
| `format:check`         | Passed                                             |
| `hygiene:artifacts`    | Passed                                             |
| `lint`                 | Passed                                             |
| `typecheck`            | Passed                                             |
| `test`                 | 466 files / 3,437 tests passed                     |
| `test:e2e --workers=2` | 38 Chromium tests passed, including 6 new fixtures |
| `build`                | Next.js production build passed                    |
| `build:worker`         | OpenNext Cloudflare Worker build passed            |
| `git diff --check`     | Passed                                             |

The primary agent implemented diagnostics, integrated all phases, inspected the
mobile and multi-chart browser screenshots and ran project validation. Sol
provided bounded architecture and independent correctness review; Astra handled
the display lifecycle, host send integration and v2 recovery/sync implementation.
Review fixes include source owners surviving normal message appends, branch
invalidation, modal keyboard containment, precise recovery traversal and sync
overlay behavior.

Browser fixtures use synthetic data and intercepted chat responses. Real-model
generation quality, deployed CSP/origin behavior, production rollout and live
cloud synchronization are unverified. No commit, deployment or Docker build was
performed. Playwright stopped its managed server; port 3100 has no listener.
Next dev's automatically appended AGENTS block was removed after the preview
server stopped, preserving the repository's original agent instructions.
