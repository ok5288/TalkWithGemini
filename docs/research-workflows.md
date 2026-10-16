# Deep Research workflows

Deep Research is a foreground chat mode for bounded, auditable research. It
creates a structured plan, waits for explicit approval, and executes that plan
in persisted waves. It is separate from Agent mode: Research has no Agent
Skills, Memory tools, JavaScript, workspace mutations, or arbitrary Plugin
functions. Refreshing interrupts a run; reopening the app only offers an
explicit Resume action.

Use this guide for templates, source adapters, recovery, reports, and report
questions. See [Trusted Agent Runtime](agent-runtime.md) for shared leases,
tool journals, approvals, and foreground execution. See
[environment variables](environment-variables.md) for provider credentials and
shared stores.

## Choose a template

Templates are permission-free defaults for the deliverable, required sections,
source priorities, and bounded strategy. Built-ins use the Standard strategy:
initial breadth 4, maximum depth 2, query cap 16, and 5 results per query.

| Template             | Deliverable       | Required sections                                                                                   |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Competitive analysis | `comparison`      | Criteria; comparison matrix; differences and opportunities; conclusion                              |
| Literature review    | `research_report` | Search scope; thematic synthesis; evidence quality and disagreements; gaps                          |
| Due diligence        | `decision_memo`   | Entity and scope; key facts; risks and gaps; items to verify; recommendation                        |
| Technical evaluation | `decision_memo`   | Requirements; option comparison; performance and maintenance risks; recommendation; validation plan |

Source priorities shape the plan and queries. They cannot enable a Plugin,
add credentials, increase a budget, or widen the approved source snapshot.
Built-ins are read-only. Duplicate one to create an editable template, or
save an approved plan as a new template; this copies the plan defaults rather
than the task or its source data. Template sections are added to the standard
report audit sections.

Template resolution follows the surrounding chat configuration:

```text
default → Workspace → Agent Profile → session → current task plan
```

An unset layer inherits. **No template** writes an explicit `null` and stops
inheritance. A task copies the resolved template when planning starts, so later
edits or deletion do not change it. The sidecar is local IndexedDB
`neo-chat-research-extensions` (schema v1); templates are not included in ZIP
export or synced between devices.

## Prepare and approve a plan

Planning starts with model knowledge and all tools disabled. Only an unfamiliar
subject or concept can trigger bounded context lookup:

- selected knowledge lookup allows at most 2 queries, 5 results per query, and
  30 seconds;
- if the subject is still unresolved, public lookup allows at most 2 queries,
  5 results per query, and 90 seconds including model waiting and queueing;
- public queries are fixed before private knowledge is read.

Lookup results are planning context, never formal evidence. Failed or skipped
lookups are disclosed and become explicit assumptions; they do not block a
plan. Planning cannot fetch pages, read ordinary attachments or workspace
files, call Plugins or MCP, load Skills, or use Memory. After the plan appears,
the source-free clarification surface can adjust or approve it.

Plans contain 3–8 steps. Initial generation and the two bounded, closed-book
repair attempts accept the same plan JSON envelope. Repairs receive the actual
field-validation issues and must merge related steps without discarding research
questions or required deliverables. If a new plan remains invalid, a labelled
three-step **starter plan** is offered for review. It follows the same host
validation and template requirements and still needs explicit approval.

The chat card shows the steps, **Thoroughness**, and one **Start** action.
**Edit plan** opens a dialog for a natural-language instruction. A failed or
cancelled edit retains the previous plan and the input; it never silently
replaces a good plan with a starter plan. Failed continuation or refresh also
preserves the previous report and restores the conversation mode.
Reloading preserves a ready plan and its thoroughness choice without approving
it; interrupted planning or execution still requires manual recovery.

If web search was disabled when the plan was created, **Open search settings**
leads to the relevant setting. Enable search, then choose **Edit plan** to
prepare a new source snapshot; changing a setting does not rewrite an approved
plan.

The versioned plan records the objective, audience, time scope, preferred and
excluded domains, assumptions, deliverable contract, stable steps, query
topics, source priorities, evidence criteria, strategy, completion criteria,
and reconnaissance log. Every adjustment creates a new plan version and needs
approval again. Approval freezes the model and reasoning settings, approval
mode, read-only tool and Plugin allowlists, knowledge collections, attachment
IDs, and workspace file IDs. Workspace sources are additionally frozen by
exact path, revision, and content hash. Skills and Memory are always excluded.

The host applies approved domains, dates, source types, and function
fingerprints at invocation time. Model filters may narrow those constraints but
cannot widen them. Expansion may use only source types and read-only functions
already authorized by the conversation. If an older saved task is paused for
scope approval, **Resume** continues from committed evidence under the current
host policy; it does not grant new conversation permissions.

## Choose thoroughness

The budget is the lower value from the selected preset and the active Agent
Profile. Task-level usage is cumulative across report runs.

| Preset   | Tool rounds | Tool calls | Active wall time | Breadth | Max depth | Queries | Results/query |
| -------- | ----------: | ---------: | ---------------: | ------: | --------: | ------: | ------------: |
| Quick    |           6 |         20 |        5 minutes |       2 |         1 |       6 |             5 |
| Standard |          12 |         50 |       15 minutes |       4 |         2 |      16 |             5 |
| Thorough |          20 |        100 |       30 minutes |       6 |         3 |      32 |             5 |

Changing thoroughness on a ready plan creates a new version and recomputes both
the strategy and actual task budget, including Agent Profile limits. Settings
apply to future tasks. Raw strategy number inputs are hidden; saved template
strategy values remain compatible. Exploration uses at most 80% of tool-call capacity and
reserves `max(2, ceil(query cap × 15%))` queries for verification. Two model
rounds are reserved for verification and synthesis. Source-body reads are
bounded by `min(query cap × 2, 64, remaining exploration calls)`.

Breadth adapts to uncovered required steps and unresolved major claims while
remaining under the configured cap. Similar or duplicate queries share one
budget identity. Verification continues only when the previous wave added a
newly verified claim; two degraded archive waves stop as
`invalid_model_output`. A run is **complete** at 100% coverage. It may stop as
**sufficient** when every required high-priority step is covered and at least
80% of major claims are verified. Other stop reasons remain explicit, including
budget exhaustion, maximum depth or queries, no new sources, no new verified
claims, dependency failure, user pause/cancellation, and scope approval.

Pause and resume keep the same report-run budget and reuse only committed,
hashed results. **Continue Research** and **Update Latest** create a new report
run with a new preset budget while task usage remains cumulative.

## Use specialized read-only sources

The Plugin Market exposes four built-in Research adapters. Search creates
discovery records; only a successful read can be committed to the evidence
ledger. Each adapter uses fixed official HTTPS hosts and separate search/read
operations. User Base URLs and redirects are rejected.

| Adapter                                                                                  | Available data                                                        | Configuration and limits                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [arXiv](https://info.arxiv.org/help/api/user-manual.html)                                | Preprint search; versioned abstract and bibliographic metadata        | No key; no PDF or full text                                                                                                         |
| [PubMed](https://dataguide.nlm.nih.gov/eutilities/utilities.html)                        | ESearch IDs; PMID record and available abstract                       | Optional NCBI API key; full text is outside this adapter                                                                            |
| [EPO OPS](https://developers.epo.org/)                                                   | Patent search; public DOCDB bibliographic data and available abstract | Client ID and secret; coverage is limited to public OPS data                                                                        |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | Company/ticker/CIK search and returned filings                        | Contact-bearing User-Agent; up to 3 matching companies and 3 historical index files per company; responses include a `coverageNote` |

Adapters run through `/api/plugins/execute` with registered built-in
definitions and only `local_read`/`network_read` effects. Arguments, response
size, XML parsing, timeouts, cancellation, retry, and provider throttling are
bounded. The plan freezes each source definition and function fingerprint;
registration and dispatch recheck the fingerprint before use.

Credentials stay in the encrypted local Plugin secret store. EPO credentials,
the SEC User-Agent, and the optional PubMed key never enter prompts, templates,
plans, evidence, report snapshots, or Q&A threads. Hosted or multi-instance
deployments require the shared Upstash pair
(`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) for provider
coordination. If the shared store is unavailable, source execution fails
closed; an in-memory limit is suitable only for one local process. Provider
errors retain their upstream, local-timeout, and authentication distinction;
BYOK decryption recovery is separate from upstream retries.

## Search and recover evidence

Within one browser tab, Research search requests share a FIFO queue with one
request in flight and at least two seconds between starts. Duplicate queries
are shown as skipped. A batch retains successful results; it fails as a whole
only when every query fails. Temporary failures (429, upstream 5xx, or transport
timeout/network failure) refund only the failed queries and release their
duplicate-query reservation, including after checkpoint recovery. Successful
empty results and permanent 4xx failures still consume their queries. HTTP 429 starts a cooldown from `Retry-After` (or
60 seconds when absent), and neither 429 nor 504 is immediately replayed.
Pause or cancellation aborts queue waits and active requests. The queue does
not coordinate other tabs or devices. Search activities distinguish rate limits,
request timeouts, the overall search deadline, exhausted query budgets, and
scope restrictions using safe localized summaries. Duplicate queries appear as
skipped. Raw provider messages, queries, and tool payloads remain hidden; unknown
or legacy errors use a generic search-failure summary.

During execution, the host saves each query reservation before dispatching its
request and saves refunds as a net ledger. Refreshing during an in-flight
search therefore cannot restore its allowance or erase duplicate protection,
even when the request has no terminal tool receipt. A checkpoint write failure
stops dispatch. Older checkpoints without the host ledger retain receipt-based
recovery.

Research search uses the optional `research_summary` profile for summaries and
image descriptions; raw page bodies come from separate read tools. Results
over 8,000 characters are stored locally before commitment. Checkpoints retain
complete redacted envelopes or exact references and hashes. An internal
`tool-results/<call>.json` path must belong to the session and match its
committed reference; missing, changed, or invalid files become body gaps and
are never fetched again during archive recovery. Model knowledge and internal
tool-result files never become formal evidence.

Evidence keeps source identity, locator, retrieval time, content hash,
authority, freshness, availability, and run/node/step/tool relationships.
Rereads can support a round without increasing its new-source count. A single
closed-book repair may retain already accepted packets; it does not replay
network reads. Major claims require usable primary evidence; secondary-only
corroboration remains pending.

Execution requests obey the remaining task budget and use a 90-second provider
timeout. Reconnaissance records accept `timeoutMs` through 90,000; older
readers that cap the field at 30,000 cannot open those records. No historical
task or report is rewritten.

## Recover and resume a task

Model requests retry twice with short delays only before any visible output or
tool/source activity. Authentication, rate limits, unsupported structured
output, and model-not-found errors are not automatically retried. Existing
checkpointed waves are not replayed. Provider errors retain their kind so the
interface can offer model settings, Retry, or Resume.

A connection loss before report text is received pauses research and preserves
committed progress. Resume is explicit after reconnecting; it does not repeat
committed tools or reset query usage. Received report text remains deliverable
as a partial report. Storage failures take priority over connection messages;
the app never treats an unsaved checkpoint as a successful save.

Repeated interruptions retain all committed tool receipts. If the tool turn
finished but its closed-book archive was interrupted, Resume finishes that
archive from saved results, even when tool budget is exhausted. A declared
checkpoint that is missing, damaged, or belongs to another execution stops
recovery before another request is sent.

The research map, node steering, and raw strategy controls are no longer
exposed. Existing steering records and the execution consumer are retained for
compatibility; an optional sidecar initialization failure does not show a
steering notice.

Core task saves must succeed before execution can acknowledge a checkpoint.
A storage failure retains the visible local task but stops further research;
optimistic UI updates are not durable save acknowledgments. Explicit retry
reopens storage under the task execution lock, compares against the last
confirmed task snapshot, and verifies the saved record by reading it back.
Only that task is recovered. A conflicting change from another tab prevents
overwriting its progress, and the local unsaved task is retained. Storage
unavailability, quota limits, blocked access, invalid task data, checkpoint
failures, and report verification failures have distinct messages. Optional extension initialization failures do not prevent unrelated research
from continuing.

Research is foreground-only. One browser tab can own at most one active task.
A read already in flight may finish and commit before a safe pause, but the
next model round is not dispatched. Refreshing or closing the page interrupts
the task; hydration never starts network work. The global Research bar offers
Resume only for a valid checkpoint, and the task lock is reacquired before
execution.

## Read, export, and question a report

Reports are delivered with explicit labels for source-backed findings,
unverified material, model-knowledge supplements, evidence gaps, and stop
reason. A partial report remains readable in chat and the workbench; an
interrupted run preserves received text and uses deterministic fallback text
when no model text exists. Model knowledge never enters the evidence ledger
and cannot support a current-fact claim without citable evidence.

Finished chat tasks collapse to one summary row above the report preview. The
report page has three tabs: **Report**, **Sources**, and **How it was
researched**. Report opens by default when available. **Notes and limits** are
collapsed below the report; the source appendix moves to Sources. Search and
sorting remain visible there, with additional filters under **More filters**.
The process tab contains steps and activity, with fact checks, the approved
contract, run details, and template saving under **Advanced details**. Only
multiple report versions show a version selector. Markdown and PDF exports
still include the complete report, appendices, and quality notices. Existing reports receive a read-only
heading projection in English, Chinese, and Japanese; saved Artifacts and
snapshots are not rewritten. A streaming document opens after streaming ends;
an interrupted partial document remains readable.

Report delivery performs one static audit and does not rewrite a report with a
second model call. Quality gaps become warnings and `partial_completed`, not a
publication gate; user pause/cancel and core-storage failures take precedence.
Publication reads back the exact report and Artifact identity before reporting
success.

Publication creates an immutable, content-addressed Artifact and attempts to
save a `ResearchEvidenceSnapshot` containing the exact Markdown, evidence,
citation mapping, gaps, and claim ledger. Snapshot failure leaves the report
readable and exportable but disables Questions for that version. Core report or
Artifact persistence failures remain real save failures. New versions record
`evidenceSnapshotStatus` as `available` or `unavailable`; only legacy versions
without this field may use restricted reconstruction from their own run, never
from later task evidence.

**Ask about this report** opens a dialog with multiple named topics per exact
report version.
Each request includes task, report-version, and topic IDs and receives only the
frozen report, evidence, claims, and completed turns from that topic. Tools,
network access, Memory, and Research startup are disabled. The host validates
citations against the frozen locators; an invalid citation fails the turn and
is not added to future history. One generation may run per topic, with
cancellation and retry of the last failed turn. Durable extension storage and
the topic lock are required; deletion cancels active answers, and session
copies remap sidecar IDs. This sidecar is local to
`neo-chat-research-extensions` v1 and is not included in ZIP export or synced
across devices. Cleanup checks report references before removing an unpublished
snapshot; global OPFS orphan sweeping remains suspended until it can share a
publisher lock.

## Continue the conversation

Only successful durable publication returns the task's conversation from
Research to **Auto**, provided it is still in Research mode and no other live
research task is visible in that conversation. Publishing in a background
conversation does not change the current composer.

Ordinary follow-ups receive the completed report from research cards present
in the current conversation branch. Each projection is bounded to about 24,000
characters; oversized reports use their summary, findings, and gaps, and the
existing overall history limit still applies. Missing report files do not
block ordinary chat. Cross-conversation and uncompleted reports are excluded.
Context compression retains the branch's task references, so later replies
still resolve the latest completed report rather than a frozen report copy.

Choose **Research more** to deliberately prepare a new plan, or **Refresh with
the latest information** in its dialog. These actions return the conversation
to Research and require approval of the new plan before execution. A failed
planning action retains the previous report and conversation mode.
Changing search or approval settings during planning does not prevent mode
rollback; a subsequent explicit mode selection is preserved.

## Images and trust boundaries

Illustrative search images are kept in a checkpointed catalog separate from
formal evidence. They do not affect claim verification, evidence counts, or
source-body usage. Synthesis may use an available image with its caption and
source URL, but never invents a URL, claims to have visually inspected an
image, or requires an image quota. Reports use standalone Markdown image
syntax; no separate image appendix is added. Each report version keeps the
catalog available to its synthesis pass, and older tasks without a catalog
continue to load.

Source content is untrusted input. Only the host authorizes tools, commits
evidence, and publishes Artifacts. When a provider returns metadata without an
abstract or full text, use the coverage note, evidence gaps, source coverage,
and stop reason to describe the limitation.

Provider references: [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html),
[arXiv terms](https://info.arxiv.org/help/api/tou.html),
[NCBI E-utilities](https://dataguide.nlm.nih.gov/eutilities/utilities.html),
[EPO OPS](https://developers.epo.org/), and
[SEC EDGAR access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).
