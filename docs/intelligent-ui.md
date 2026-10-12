# Intelligent UI

Intelligent UI lets a model combine prose with local controls in ordinary chat
and Agent answers. It uses Neo Chat's existing provider adapters and message
storage. It does not implement ChatGPT's private compiler. A separate, experimental
MCP Apps display host is available with an independently deployed sandbox.

## Controls and everyday use

**Settings → System → Intelligent UI** is enabled by default, including when
loading older settings without this field. Turn it off to remove generation
instructions and unmount interactive runtimes. Existing interfaces become
readable static content; saved state is retained for re-enabling the feature.
The separate HTML visual-prompt setting, ordinary Markdown, diagrams, and
manual HTML code previews retain their existing behavior.

Models decide whether interaction is useful. A short factual question should
still receive prose. Ask for plain text or code examples when that is what you
need. Support depends on the selected model following the protocol; Neo Chat
does not change providers or automatically retry malformed interfaces.

| Component  | Example                                        | Local behavior                                               |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Checklist  | Packing or study plan                          | Check items, count progress                                  |
| Comparison | Compare user-provided travel options           | Filter, sort, select                                         |
| Form       | Study goal and time available                  | Labeled text, numbers, choices, sliders, validation          |
| Chart      | Explore an existing table                      | Select metrics, filter rows, inspect a data table            |
| Quiz       | Practice from an attachment                    | Score, explanations, wrong-answer or all-question practice   |
| Flashcards | Review concepts and formulas                   | Reveal, self-rate, review unmastered cards                   |
| Calculator | Split 100 between three people                 | Registered arithmetic, scaling, splitting, weighted averages |
| Explorer   | Compare trip costs across nights and travelers | Linked table, chart, parameters, selection and totals        |
| HTML       | Explore a mathematical relationship            | Local forms, SVG or Canvas in an isolated frame              |

Comparison and chart definitions label their data as user-provided, sourced,
or illustrative. These labels do not independently verify facts. Check the
surrounding citations; changing a value in a simulation does not create new
research evidence.

Interfaces appear as part of the answer without a host border, title bar or footer.
Ordinary controls run locally. A clearly labeled AI button may call
`window.intelligentUi.sendMessage(text)` on a real click to append an editable
draft to the main message input and focus it. Filling the input does not send
anything. Existing draft text, attachments and the reply target are retained;
the user's normal Send action submits them together with the edited text and
the interface's frozen result context. Clearing or replacing the draft cancels
the pending interface request. Loading, timers and ordinary input
changes cannot send messages. The existing tool confirmation flow still applies.
Runtime failures and unsaved state display host retry actions; interface-specific controls
remain inside the content.
An HTML error, unexpected reload or unmount also permanently invalidates that
instance's pending send proposal. Retrying the interface creates a new instance;
it cannot revive an earlier pending request.

Completed Research reports offer **Explain interactively in chat**. This opens
an ordinary chat draft referencing the selected immutable report version and
its attachment. It does not modify the report, evidence snapshots, research
execution, or evidence-answer rendering policy.

## State, privacy, sharing and export

Definitions and JSON state live inside message output blocks in the existing
session tree. They participate in private backups and the existing encrypted
session sync. Copies get independent state and new block identities; regenerated
answers use separate branches. Switching sessions or unmounting the card closes
the HTML communication port. Temporary-session state is memory-only.

Normal chat and SDK sends include canonical interface source and the latest
reported visible results from the applicable conversation branch. Native controls
project known visible fields; HTML uses `reportSnapshot`, never an automatic dump
of arbitrary saved state or hidden form fields. A missing snapshot is marked
unavailable. These are context data, not system instructions or live DOM access.
Context limits and provider routing still apply; a clicked SDK source is retained
for its request even when older history has been compressed.

Public sharing and Markdown/PDF/image exports default to the original static
version. Select **Include my inputs and results** to include visible current
values. Hidden native-state keys are omitted. HTML authors must publish a plain
text snapshot; its text is escaped, never executed, and included only after the
user opts in. Current output labels this snapshot as reported by the interface,
and explicitly identifies a missing snapshot. Inspect it before sharing. HTML screenshots/Canvas images are not
automatically captured; the supplied snapshot or original summary is the
readable fallback. Reading mode and exports do not mount the interactive runtime.
Private JSON backups preserve definitions and state rather than using this public
projection. Markdown copies and knowledge-base additions use original static text.

Quizzes save the current question set, answers and submission status, plus each
question's most recently submitted answer. Wrong-answer practice reuses stable
question IDs, clears the current round's answers and hides explanations until
submission. All-question practice retains recent results. Repeated submission cannot accumulate scores. Older saved
quizzes restore as an all-question round.

Flashcards save the current card, answer visibility, review scope and latest
self-rating for each card. Reveal the answer before choosing known or needs
practice. Moving to another card hides its answer. Fronts and backs support safe
read-only Markdown and math. These records belong to the current conversation;
there is no spaced-repetition schedule, full event log or shared learner profile.

## Linked data exploration

The native `explorer` uses one typed dataset for its table, chart and registered
calculations. Changing parameters, filters, sort order or selected rows recomputes
locally. A trip comparison can calculate hotel plus transport, filter by total
budget, and divide selected cost between travelers. Empty selections remain
empty; missing values are not silently treated as zero. Invalid inputs and unsafe
numeric intermediates produce errors rather than stale results.

Native Chart filtering runs only when the host can prove a single inline dataset
and its series mapping. Interactive charts support bar, line, scatter and pie;
new definitions specify dimensions and encode explicitly. Uncertain dataset
indices, headers, row layouts, nested options or extra data sources keep their
original definition and render statically with a reason. A filtered array is
converted to object rows only for rendering, so ECharts cannot reinterpret its
first remaining text row as a header. Each chart is assessed independently.

CSV or JSON import supports a preview and explicit column-type correction. Map
each expected column to an imported column before confirming replacement; the
host does not guess equivalent names. Mismatched types or currency units are
rejected, and omitted extra columns are identified. Imports are limited to 1 MiB,
1,000 rows and 20 columns. The computation graph allows at most 16 registered
nodes; it cannot execute formulas or JavaScript from imported cells.

Confirmed imports are private user data stored with the current interface. Public
output defaults to the original definition; opting into current results includes
only selected rows and visible fields. The explorer's own import controls manage replacement data. Private backup retains the
import. Deployment operators can disable new exploration with the build-time
`NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER=false` switch; existing definitions
remain readable and other native components remain available.

## Traceable materials and tool results

The host creates bounded source aliases for accessible attachments, knowledge
files, report/evidence versions and supported tool results. A context-backed
explorer names an exact alias and version; source identities and hashes are
resolved by the host rather than trusted from model text or restored bindings.
Missing, changed or revoked materials cannot silently resolve to a different
version. Source labels identify a binding, not a fact-check. Calculated values
remain derived interpretations and never update immutable research evidence.
Research materials are read from their repository using the referenced version,
including before its workbench has loaded. Repository deletion or replacement
invalidates cached access. Frozen public output includes supported tool results
only through the same authorized source scope, even in tool-only answers.

Supported completed search and explicitly schema-declared table results receive
interactive tables. A stored descriptor binds the adapter, call, result hash and
captured time. Unknown, malformed or unrelated results keep the ordinary result
view. Search, filters and selection are local. **Request refresh in chat** puts a
request in the editable composer; it does not rerun a tool automatically.

With Agent mode, a durable session workspace and current write authorization,
selected visible results can be saved as a new Markdown draft after an explicit
confirmation. The preview identifies content, destination and result version.
The existing execution journal and workspace queue guard the write; repeating a
confirmed operation does not overwrite a file or blindly repeat an operation
whose outcome is unknown. A receipt distinguishes success, failure and uncertain
outcome. This release does not enable arbitrary external writes from UI controls.
Attempt history and a separate highest-attempt record are saved atomically in
the existing local execution journal. Missing or corrupt recorded attempts block
another write; a running create-only draft restored after refresh is an unknown
outcome. Older failed histories without this independent record remain readable
but cannot authorize a new attempt. History already completely lost before this
record existed cannot be reconstructed. The application restore lock covers the
whole journal, workspace write and receipt sequence.

## Experimental MCP Apps display host

**Settings → System → MCP Apps** is off by default and also requires Intelligent
UI to be enabled. Configure `NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN` during the main
application build and deploy the [separate sandbox](../deploy/mcp-app-sandbox/README.md)
with its allowed `MCP_APPS_HOST_ORIGIN`. Missing or same-origin configuration does
not create a runtime. Installed MCP tools without complete versioned visibility
metadata require **Refresh tool definitions** before model discovery or execution.
Refresh preserves configuration and credentials; failure preserves the old definition.
Visibility is retained independently of the App resource URI. App-only tools are
excluded from Chat, Agent and Research discovery, dynamic loading and execution.

The host uses the standard AppBridge lifecycle and a guarded transport. The App
cannot become ready before the SDK's successful initialize response has actually
been sent and the App has acknowledged it. Theme changes during initialization
are cached; complete host context is updated before sending tool results. It loads
only the resource declared by the current installed tool, verifies metadata and
permissions, and sends visible result text. This restricted profile sends no tool
arguments or hidden structured metadata. It exposes no tools, model-context writes,
chat sends, arbitrary resources, external network capability or browser permissions.
Apps requiring those capabilities are outside this profile and fall back to the
ordinary result. Loading and initialization have deadlines and manual retry;
closing, switching conversations or revoking settings releases the instance.

This profile does not support stateful server notifications or persistent App
internal state. It is separate from `intelligent-ui HTML` and does not enlarge `intelligentUi` bridge
permissions. Unit/SDK tests and builds do not establish real-browser isolation,
navigation safety, deployment headers or real App interoperability. Those remain
independent release acceptance conditions; no claim of universal MCP Apps support
or hard CPU isolation is made.

Unknown future UI versions and kinds remain preserved in private backups but
cannot execute. They render a readable summary; synchronization refuses to write
unsupported content back over the remote snapshot. Upgrade to a compatible client
before resuming that sync. No compatibility mechanism can change the behavior of
an older deployed client.

## Model protocol, version 1

The normal text stream carries reserved fenced blocks. The setting and injected
system instructions authorize recognition in model responses. User messages,
ordinary `html` fences, quoted examples inside outer fences, tool results, and
long-text document captures do not become executable interfaces.

````markdown
```intelligent-ui
{"version":1,"kind":"checklist","title":"Packing","summary":"Prepare for the trip.","props":{"items":[{"id":"passport","label":"Passport"},{"id":"charger","label":"Charger"}]}}
```
````

Native props are validated independently by kind. Unknown fields are discarded;
functions, JSX and arbitrary React props are not supported. The full component
schema and model guidance are maintained in the static
[`capability catalog`](../src/lib/intelligentUi/catalog.ts) and
[`prompt.ts`](../src/lib/intelligentUi/prompt.ts). Calculators execute registered
host functions with finite, safe-range checks on every intermediate result.
Splitting rounds the number's standard decimal representation half-up to integer
minor units at the requested precision, then distributes remainders in input order
(for example, 1.005 at precision 2 becomes 101 minor units).
Explorer retains its existing signed currency rule: conversions use
`Math.round((value + Number.EPSILON) * 10 ** precision)`, whose exact midpoints
round toward positive infinity. Its calculation explanations describe that rule
separately from calculator splitting; for example, -101 divided by 2 at precision
0 remains -50.
Explorer splits without a currency unit round the total with `Math.round` to an
integer before assigning remainders in row order. Their visible and exported
explanations state this rule; for example, 1.5 split between two gives 1 and 1.
Scaling requires all three inputs (amount, original quantity, target quantity).
Quiz answer IDs must be unique and belong to their options. Form definitions
and restored inputs are checked against field types, choices and numeric bounds.

````markdown
```intelligent-ui
{"version":1,"title":"Counter","summary":"An example local counter."}
<button id="increment" type="button">Add one</button><output id="value"></output>
<script>
let count = Number(window.intelligentUi.initialState.count || 0);
function render() {
  document.getElementById("value").textContent = String(count);
  window.intelligentUi.setState({ count });
  window.intelligentUi.reportSummary("Count: " + count);
  window.intelligentUi.reportSnapshot("Count: " + count);
}
document.getElementById("increment").addEventListener("click", () => {
  count += 1;
  render();
});
render();
</script>
```
````

The first HTML line is strict JSON metadata; subsequent lines are source. Use a
longer outer fence if source contains backticks. A closing fence is accepted
only after its line terminates or the stream finishes. Partial HTML is parsed
in an inert template and shown as a sanitized, scriptless preview. Full validated
blocks may become interactive before later prose finishes. Subsequent prose
does not remount the frame or overwrite newer local state. Incomplete or cancelled
blocks remain static after restoration; unknown versions retain a readable summary.

The runner is already loaded when scripts are inserted. Initialize immediately;
for conventional listeners it replays `DOMContentLoaded` once after insertion.
Use bounded work and accessible labels. Ordinary JS variables are not persisted.
The frozen `window.intelligentUi` bridge exposes:

| Member                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `initialState`         | JSON state saved by this instance                          |
| `setState(object)`     | Save explicit local JSON state                             |
| `reportSummary(text)`  | Report a plain text summary; does not stage a draft        |
| `reportSnapshot(text)` | Save visible results for chat context and selected exports |
| `reportHeight()`       | Measure content height; also observed automatically        |
| `sendMessage(text)`    | Fill an editable chat draft after AI-button activation     |

An AI button must use `type="button" data-neo-ai-action`. Call `sendMessage`
synchronously within its real click handler, before any `await`, after saving the
current snapshot. The Promise resolves to `{ok:true,messageId}` after the user
message is accepted, or `{ok:false,code}`. Handle busy, inactive, offline,
model_unavailable, invalid_message, user_action_required, cancelled and send_failed without
automatic retries. Model generation completion is separate from acceptance.
Keyboard activation works through the same button click. One activation creates
one proposal. Only the user's normal composer Send action authorizes sending;
gesture checks are an additional interaction guard. The host freezes the result
context when the interface is clicked, uses the edited message at send time,
waits for pending local saves, and rechecks the instance, branch,
definition, source permissions, model and availability before dispatch.
Switching conversations, changing the definition or revoking access invalidates
the proposal without silently sending it as ordinary chat. A failed save keeps
the draft available for retry. Pending source context is not backed up or resumed
after reload; only ordinary draft text is restored. This does not replace tool confirmation.
Authorization is checked again after asynchronous history and Skill preparation,
on request retries, and at the proxy fetch or direct SDK dispatch boundary. If
the user message has already been accepted, later revocation preserves that
acceptance receipt but stops the response with an authorization-expired message.
These checks cannot retract a request that has already been dispatched.

### Runtime limits and saving

The SDK copies state when `setState` is called and coalesces the latest value per
channel for up to 100 ms, preserving the last call order. If a later update or
script fails, already validated queued values are delivered before termination;
the invalid value is never saved. Before a chat proposal it
flushes pending updates over the same port; this does not itself guarantee disk
persistence. The host independently validates every update.

State is limited to 256 KiB of UTF-8 JSON and depth 24, snapshots to 64 KiB, and
summaries to 8 KiB. Height is clamped to 16384 px with scrolling inside the frame.
The host accepts 60 messages per second with a burst of 120 and at most 1024
distinct send request IDs per instance. Invalid or excessive input ends that
runtime and retains the last accepted state. Older oversized state remains in
private storage and renders statically; it is never truncated or reset.

HTML updates enter memory immediately. Durable writes share the session message
queue and a fixed 100 ms coalescing window. Normal message operations cannot be
overtaken by delayed UI writes. Send confirmation, output preparation, cloning,
session changes, backups and sync wait for pending writes. A failed save retains
the latest state and offers **Retry saving**; an in-memory update is not a receipt
for a successful save. Temporary conversations have no durable UI writes.
Before consuming or leaving an HTML interface, the host first requests an update
flush and acknowledgement on its MessagePort, then drains the database queue.
This includes buffered updates that have not reached the host yet. Native
interfaces save immediately and retain failed updates for the same explicit retry.
Regeneration and continuation use this same barrier before reading history or
changing branches. Single-message current Markdown, PDF and image export re-read
the target message after the barrier rather than using a stale rendered prop.
Page hiding and closing trigger best-effort flushing, but abrupt termination
cannot guarantee completion of asynchronous browser storage.

Standard HTML, SVG and MathML presentation, local forms, dialogs, datalists and
templates are supported. HTTPS images, audio/video and fonts may load. Classic
scripts, module scripts and styles may load from `cdn.jsdelivr.net/npm/`,
`cdnjs.cloudflare.com/ajax/libs/` and `unpkg.com`; font CSS also supports
`fonts.googleapis.com`. Use pinned versions and complete paths. Scripts load in
source order, awaiting each script load event before continuing. Inline modules
use temporary Blob URLs, revoked on success, failure or cancellation. A module
load event does not wait for top-level `await`; keep dependent asynchronous
initialization in the same module and await it explicitly.
Module imports must use absolute allowed CDN URLs; bare imports and import maps
are not supported. Media failures need not invalidate unrelated content.

Inline event attributes (such as `onclick` and `onsubmit`), `eval`/`new Function`,
and JSON data scripts (`application/json`, `application/ld+json`) are supported
inside the executable frame. JSON data stays in the DOM for scripts to read.
Static previews still remove scripts and event handlers, including inside templates.
Prefer `addEventListener` when structuring larger interfaces.

Network APIs, nested frames, objects and navigable forms remain unavailable. The
sandbox has no `allow-same-origin`; use constructors from the frame's own window,
never inspect `parent`/`top` DOM or constructors. State persistence uses the SDK.
A `SecurityError` while reading `HTMLElement`, `GPUQueue`,
`CanvasRenderingContext2D` or `AudioBuffer` on another Window is a cross-origin
access failure, not a JavaScript syntax rejection. These syntax allowances do not
permit host scripts or injected browser scripts to inspect the isolated frame.
Diagnosing such a failure requires the calling script and stack; do not grant
`allow-same-origin` to this same-site runner as a compatibility workaround.
External resource requests disclose information to their providers (including IP
and requested URLs); allowing media means this is not a zero-egress sandbox.
Never embed private input in resource URLs. The host does not expose its API keys
or offer a server-side resource proxy.

### Local HTML forms

`<form>` supports browser constraints (`required`, `min`, `max`, `step`,
`pattern`, length constraints), submit/reset listeners and controls associated
through the `form` attribute. The runner prevents submit navigation while allowing
generated event handlers to calculate results. Both sandbox layers use
`allow-forms` so native validation and submit events work; navigation remains
blocked by the submit listener and `form-action 'none'`. It does not grant navigation
configuration: `action`, `method`, `target`, `enctype`, `formaction`,
`formmethod` and `formtarget` are rejected, and CSP retains `form-action 'none'`.
Call `intelligentUi.setState` and `reportSnapshot` after changes and reset; the
host never harvests all form fields. Local form submission does not send chat; use
a separate explicit AI button for that. Static previews disable controls, load no
external resources and run no handlers. A complete recipe form example is shared by the prompt and parser
tests in [`promptExamples.ts`](../src/lib/intelligentUi/promptExamples.ts).

## Deployment boundary

`/intelligent-ui/sandbox` returns a fixed, no-store runner with its own CSP and
response sandbox. Generated content arrives only through a per-instance
MessageChannel; it is absent from request URLs and runner responses. The parent
binds the channel to that exact iframe and a fresh runtime identity; late events
after unmount and reload are rejected. The PWA routes this URL to the network
without offline-shell fallback. An offline HTML runtime may therefore be unavailable;
the static summary remains usable.

Definition completion and runtime readiness are separate. The frame starts in
**Starting**, waits for the runner's ready acknowledgement, then becomes
interactive. Loading and channel handshake have a five-second deadline; after
connection initialization has 30 seconds, with 10 seconds per external resource. Failure closes the port, removes the frame and shows readable
static content with an explicit retry. There is no automatic retry. Disable,
branch/session changes and unmount invalidate the old runtime identity.

The main application's CSP is unchanged. The runner is excluded from its global
headers because combining parent CSP/X-Frame-Options DENY with the runner headers
would prevent it from working. Reverse proxies must preserve this exact exception
and the runner's `frame-ancestors 'self'`; do not weaken headers on other routes.

CSP plus sandbox restricts resources and capabilities, but `connect-src 'none'`
alone is not a proof of zero outbound traffic. In particular navigation and
redirect behavior requires real-browser acceptance. DOM iframes also provide no
reliable CPU or memory hard isolation; a timer in the parent cannot guarantee
termination of an infinite loop. This implementation must not be marked ready
for public HTML auto-execution until the browser matrix below passes.

## Delivery and validation

Implementation was integrated in these independently testable steps:

1. Settings, prompt gating, protocol recognition, stable ordered blocks and static
   fallbacks. Accept legacy settings and interrupted histories without execution.
2. Native renderers and explicit SDK chat actions. Accept local operations,
   validation, deterministic calculation and retained state during streaming.
3. Inert HTML preview, fixed runner, constrained channel and explicit persistence.
   Accept complete-only execution, one start per instance and stale-event rejection.
4. Session cloning/persistence, public projections and Research entry. Accept
   independent copied state and opt-in private values without changing evidence APIs.
5. Project tests, type/lint/format/import checks, Next and Cloudflare builds. Do
   not infer real-provider quality, browser isolation, or deployment success from
   these local checks.

Automated coverage is in `src/__tests__/intelligentUi*.test.*` plus existing chat,
sharing, Research, CSP and service-worker regression suites. JSDOM sandbox tests
check document/bridge logic; they do not enforce browser CSP or navigation rules.

Release acceptance still requires browser checks of
external images/scripts/CSS, Fetch/WebSocket/Beacon, forms, same-origin and
cross-origin navigation/redirects, stale and forged events, 390/768/1440px layouts,
keyboard/focus/screen-reader behavior, themes, and strict deployment headers.
Separately validate real model output for OpenAI Chat Completions/Responses,
Gemini and Anthropic across supported proxy/direct paths. No E2E, real-provider
requests or deployment are implied by the local test suite.

### Local verification record (2026-10-10)

The protocol, HTML runtime, direct-send bridge and continuation changes passed
441 Vitest files / 3,096 tests, TypeScript, ESLint, formatting, import checks,
artifact hygiene, the Next production build and the Cloudflare Worker build.
The suite includes regression coverage for persisted snapshots in the final
provider request, required SDK context after history trimming, send reservations,
message acceptance receipts and opaque-window connection without constructor
inspection.

A temporary local component page used the actual renderer and sandbox with a
stubbed chat callback. Manual browser checks covered 390, 768 and 1440px widths
without horizontal overflow, light/dark themes preserving inputs, height growth
and shrinkage, local form submission, mouse and keyboard AI-button activation,
a pinned CDN script and a Fetch request rejected by CSP. This does not establish
full chat-to-provider behavior, the complete browser security matrix above, or
real-model output quality. The original four reported cross-origin errors were
not reproduced with their original generated blocks and call stacks; diagnostic
support and the isolated connection regression do not prove their root causes.

No E2E tests, real-provider calls, commits or deployment were performed. The
temporary component page, preview tab and local server were removed or stopped.
Earlier architecture results remain in
[the historical implementation record](intelligent-ui-refactor-plan.md).

### Repair verification record (2026-10-11)

The follow-up review's fourteen findings have dedicated implementation and
regression coverage:

| Finding | Repair and verification boundary                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F01     | Bind pending sends to the actual HTML runtime; error, reload, unmount and retry permanently revoke old proposals.                                |
| F02     | Read exact Research repository versions and recheck frozen source authority after asynchronous preparation and before dispatch.                  |
| F03     | Validate dataset indices, dimensions and encode; actual ECharts SSR verifies filtered table and plotted row agreement without header inference.  |
| F04     | Preserve validated SDK updates before fatal errors, including updates buffered during initialization.                                            |
| F05     | Regeneration and continuation wait for runtime acknowledgement and storage, reread history, and serialize pending branch actions.                |
| F06     | Current single-message Markdown/PDF/PNG exports wait and reread the target message.                                                              |
| F07     | Persist server plugin definitions before publishing cache entries; serialize same-ID registrations and preserve the prior definition on failure. |
| F08     | Atomic highest-attempt evidence and strict raw journal reads reject missing or corrupt draft histories.                                          |
| F09     | Recover running create-only drafts as unknown outcomes, including receipt-save failure after a successful write.                                 |
| F10     | Hold the application restore lock and session lock across journal, workspace effect and receipt.                                                 |
| F11     | Tool-only sharing establishes a source scope; missing scope cannot expose tool projections.                                                      |
| F12     | Actual MCP messages contain complete host context before tool input/result and retain fixed fields on updates.                                   |
| F13     | Non-currency split explanations describe the existing integer rounding and ordered remainder behavior in all three languages.                    |
| F14     | Current HTML projections label escaped snapshots as interface-reported and identify missing snapshots in all three languages.                    |

Integration review also added damaged-success-receipt checks, branch-lock release
after synchronous exceptions, and authorization-error propagation through search
and image planning. Controlled asynchronous tests cover history/Skill preparation,
proxy signing, BYOK replay, pre-output retry, direct uploads and tool-result updates
without real provider calls. Existing schema version, private backup format and
historical UI definitions remain unchanged.

The local Vitest suite passed **457 files / 3,282 tests**. Import checks, Prettier,
artifact hygiene, ESLint, TypeScript, the Next production build and the Cloudflare
Worker build also passed. No browser, E2E, real-provider, commit or deployment
acceptance was performed in this repair run. No preview services or Docker
artifacts were created; all task-started build and test processes finished.

## Module responsibilities

- **Instance module:** identity, eligibility, generation leases, runtime startup,
  timeout and release. React, MessageChannel and the existing session store are
  adapters; the session tree remains authoritative for persistent state.
- **Native capability module:** a compile-time catalog owns per-kind schemas,
  initial and normalized state, validation, derived results and prompt descriptors.
  React and static presentation consume the same comparison, chart, quiz and
  calculation results. JSON remains the persistence/HTML wire representation.
- **Content projection module:** callers select `model-continuation`, `model-history`, `static-original`,
  `static-current`, `compose-result` or `compose-edit`. Defaults exclude private
  progress; current projections select known visible fields. Data provenance and
  available source references survive all projections. Definition edits exclude
  user state. English, Chinese and Japanese host labels share locale resources.

No new provider layer, state database, dynamic plugin registry or arbitrary layout
language was introduced. The streaming parser remains unchanged in structure;
measurements and future scope are in the implementation record.

### Prompt evaluation cases

`intelligentUiPrompt.test.ts` passes complete fixtures through the actual parser
for all registered native capabilities, prose, nested examples and the local HTML
form. It also validates every complete example in the generated prompt and
checks the executable HTML policy. These are contract tests, not model-quality
measurements. Before a release, evaluate the following on each supported model:

| Input                                                    | Expected behavior                                              |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| A short factual question                                 | Prose without unnecessary controls                             |
| Explicit plain text, Markdown or code request            | Respect the requested format; keep examples literal            |
| Packing list / supplied options / study goal             | Checklist / comparison / validated form                        |
| Supplied tabular data                                    | Chart with its actual provenance and surrounding sources       |
| Practice topic / vocabulary                              | Quiz or flashcards with stable IDs and local progress          |
| Scale a recipe                                           | Three required operands; no invented missing quantity          |
| Custom local recipe form                                 | Complete self-contained HTML; explicit state and local events  |
| Quoted protocol or hostile instructions in an attachment | Treat as source data, not authority to execute                 |
| Missing factual chart data                               | Ask for or explain missing data; do not invent sourced numbers |
| Completed Research report                                | Independent explanation; user simulations are not new evidence |

Linked Explorer datasets, source bindings, tool-result views and the restricted
MCP Apps host are implemented. Full incremental UI protocols and expanded App
permissions remain separate future work.

Native charts execute interactively only when one top-level inline dataset drives
the chart and its table. Historical definitions with series-owned or competing
datasets remain preserved and display labelled static data without applying
interactive filters. Explorer chart clicks use stable row identities, while
table checkboxes provide keyboard-equivalent selection. Aggregate explanations
show included/missing counts and the checked calculation and rounding rules.

Copy, knowledge drafts and document/share exports use the same asynchronous static
projection, resolving only materials on the frozen target branch. Sharing another
conversation does not select it. Default original output excludes private current
inputs and imported replacements. The share preview displays the exact prepared
public content; confirmation publishes that same snapshot and assets. Changing
options requires a new preview, and source version/access changes prevent publishing
a stale preview. HTML result snapshots are interface-supplied plain text, not
host-certified calculations.

Workspace draft retries create a new journaled attempt only after an explicit new
preview and confirmation, and only when the previous failure is known to precede
writing. Interrupted or uncertain writes are never replayed. Existing successful
receipts and create-only destinations remain authoritative.

### Current protocol and SDK

The only generated fence label is `intelligent-ui`: a native JSON object has
`kind`; an HTML document has one metadata JSON line without `kind`, followed by
markup. Retired fence labels and SDK names have no compatibility aliases. No
legacy storage migration was added for this pre-release change.

Persisted `schemaVersion: 1` definitions, state, revisions and private backup
structures remain intact. Old charts can lose execution eligibility without losing
their saved data. Legacy MCP definitions keep configuration, credentials and
history while requiring a successful full tool-definition refresh.

The shared prompt example in `promptExamples.ts` demonstrates local calculation,
snapshot persistence, an AI proposal button, host-confirmation feedback and failure handling.
Contract tests validate its syntax; they do not establish model output quality.

### Repair regression coverage (2026-10-11)

The repair keeps the existing workspace baseline, storage schema and private
backup format. Each area has local regression coverage:

| Area                                              | Implementation boundary                                                      | Regression coverage                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer sends and tool visibility                | `useSendMessageFlow`, plugin resolver and registered MCP execution           | `intelligentUiChatSend`, `intelligentUiIntegration`, `mcpVisibility`, `mcpRefresh`: editable drafts, manual send, frozen content, cancellation, stale permissions, model-only filtering and authenticated refresh                                                                                                                                                      |
| Native data correctness                           | Calculator, Explorer derivation and chart capability                         | `intelligentUiCalculations`, `intelligentUiExplorerDomain`, `intelligentUiExplorer`, `intelligentUiChart`, `intelligentUiCompatibility`: raw range edits, checked intermediates, decimal split conservation, static legacy datasets, renderer/ECharts SSR agreement and private-data preservation                                                                      |
| Runtime limits and durable saving                 | SDK/host guards, runtime flush registry and per-session write queue          | `intelligentUiRuntimeLimits`, `intelligentUiSandbox`, `intelligentUiInstance`, `sessionMessagePersistence`, `intelligentUiState`, `sessionCreationGate`, `intelligentUiLegacyHtmlState`, `appExport`: call-time copies, bounded inputs, coalescing, acknowledgement order, failed saves, retries, deletion rollback, session isolation and lossless legacy JSON backup |
| Frozen sources and public output                  | Source context, asynchronous projection and prepared sharing                 | Source-binding/connected-source tests, `intelligentUiPortability`, sharing snapshot/client/UI tests and `messageMutationFlows`: target-branch isolation, repository sources, original/current boundaries, preview payload reuse and final authorization guards                                                                                                         |
| Restricted MCP Apps lifecycle                     | Public SDK transport schemas, runtime and effective capability configuration | `mcpAppsTransport`, `mcpAppsRuntime`, `mcpAppsPolicy`, `mcpExecuteRoute`, `mcpExecutor`, `pluginService`: legal initialization stages, complete host context, current opt-in configuration and server-registered definitions                                                                                                                                           |
| Interaction, accessibility and safe draft retries | Chart adapter, shared calculation explanation and draft journal              | `markdownCharts`, `intelligentUiExplorer`, `intelligentUiMetricExplanation`, `intelligentUiToolDraft`: listener lifecycle, stable row selection, error association, missing/zero distinctions, shared three-language explanations and create-only attempt chains                                                                                                       |

The final local Vitest run passed **450 files and 3,208 tests**. Import, artifact,
formatting, lint, TypeScript, production Next.js and Cloudflare Worker build checks
passed. These
checks do not establish real-provider behavior, browser process isolation,
cross-origin browser interoperability or actual screen-reader usability. E2E,
real-provider requests, commits and deployment were outside this repair's
authorized verification scope.
