import { resolveWorkspaceUrl } from "@/lib/agent/workspace";
import { runWithAppDataWriteLock } from "@/lib/data/appRestoreJournal";
import type { ToolCall } from "@/types";
import { hashToolArguments } from "@/lib/agent/toolArguments";
import {
  createAgentRun,
  prepareToolExecution,
  markToolExecutionRunning,
  commitToolExecution,
  failToolExecution,
  markToolExecutionEffectUnknown,
  transitionAgentRunStatus,
  type ToolExecutionRecord,
  type AgentRun,
} from "@/lib/agent/run";
import { getAgentRunPersistence } from "@/services/agent/runtime";
import {
  acquireAgentRunLease,
  releaseAgentRunLease,
  checkpointAgentRunLease,
} from "@/services/agent/runLease";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";
import { resolveToolResultView } from "./adapters";
import { renderToolResultSnapshot } from "./projection";

export interface ToolDraftProposal {
  sessionId: string;
  messageId: string;
  callId: string;
  resultHash: string;
  definitionFingerprint: string;
  sourceExecutionId: string;
  selectedIds: string[];
  visibleColumns: string[];
  content: string;
  path: string;
  hash: string;
  runId: string;
  locale: string;
  attemptNumber: number;
  previousRunId?: string;
}
async function buildToolDraft(input: {
  sessionId: string;
  messageId: string;
  call: ToolCall;
  selectedIds: string[];
  visibleColumns: string[];
  locale?: string;
}): Promise<ToolDraftProposal | null> {
  const view = await resolveToolResultView(input.call);
  if (!view || !view.descriptor.executionId) return null;
  const selected = new Set(input.selectedIds);
  const visible = new Set(input.visibleColumns);
  const rows = view.dataset.rows.filter((row) => selected.has(row.id));
  const columns = view.dataset.columns.filter((column) =>
    visible.has(column.id),
  );
  if (
    !rows.length ||
    !columns.length ||
    selected.size !== rows.length ||
    visible.size !== columns.length
  )
    return null;
  const content = await renderToolResultSnapshot(input.call, {
    purpose: "compose-result",
    locale: input.locale,
    state: {
      selected: input.selectedIds,
      visibleColumns: input.visibleColumns,
    },
  });
  if (!content) return null;
  const binding = {
    sessionId: input.sessionId,
    messageId: input.messageId,
    callId: input.call.id,
    resultHash: view.descriptor.resultHash,
    definitionFingerprint: view.descriptor.definitionFingerprint,
    sourceExecutionId: view.descriptor.executionId,
    selectedIds: rows.map((r) => r.id),
    visibleColumns: columns.map((c) => c.id),
    content,
    locale: input.locale ?? "en",
  };
  const hash = await hashToolArguments(binding);
  // Creation is conditional on absence; existing files are never overwritten.
  const suffix = hash.replace(/^[^:]+:/, "");
  return {
    ...binding,
    hash,
    path: `drafts/tool-result-${suffix}.md`,
    runId: `ui-draft-${suffix}`,
    attemptNumber: 1,
  };
}

const SAFE_PREWRITE_ERRORS = new Set([
  "action.confirmation_expired",
  "WORKSPACE_QUOTA_EXCEEDED",
  "WORKSPACE_FILE_TOO_LARGE",
  "WORKSPACE_FILE_EXISTS",
  "WORKSPACE_REVISION_CONFLICT",
  "WORKSPACE_INVALID_PATH",
]);

function retryable(execution: ToolExecutionRecord): boolean {
  return (
    execution.status === "failed" &&
    !execution.receipt &&
    !execution.resultRefs?.length &&
    execution.error?.recoverable !== false &&
    SAFE_PREWRITE_ERRORS.has(execution.error?.code ?? "")
  );
}

function retryableRun(run: AgentRun): boolean {
  return (
    (run.status === "failed" || run.status === "cancelled") &&
    run.toolExecutions.length === 1 &&
    retryable(run.toolExecutions[0])
  );
}

function attemptId(base: string, attempt: number): string {
  return attempt === 1 ? base : `${base}-a${attempt}`;
}

/** IDs encode the predecessor; every earlier journal must still be present. */
async function draftHistory(
  base: ToolDraftProposal,
  requireEvidence = false,
): Promise<AgentRun[]> {
  const { runs: records, hasEvidence } =
    await getAgentRunPersistence().readDraftHistory(base.runId, base.sessionId);
  if (requireEvidence && records.length && !hasEvidence) {
    throw new Error(
      "Legacy workspace draft history cannot authorize another attempt",
    );
  }
  const runs = records
    .filter(
      (run) => run.id === base.runId || run.id.startsWith(`${base.runId}-a`),
    )
    .sort((a, b) => {
      const number = (id: string) =>
        id === base.runId ? 1 : Number(id.slice(base.runId.length + 2));
      return number(a.id) - number(b.id);
    });
  runs.forEach((run, index) => {
    const execution = run.toolExecutions[0];
    if (
      run.id !== attemptId(base.runId, index + 1) ||
      run.sessionId !== base.sessionId ||
      run.modelMessageId !== base.messageId ||
      run.toolExecutions.length !== 1 ||
      !execution ||
      execution.runId !== run.id ||
      execution.callId !== run.id ||
      execution.toolName !== "write_workspace_file" ||
      execution.definitionFingerprint !== "ui-workspace-draft:create:v1" ||
      execution.argumentsHash !== base.hash ||
      execution.targetSummary !== base.path ||
      (index < runs.length - 1 && !retryableRun(run))
    ) {
      throw new Error("Invalid workspace draft attempt history");
    }
  });
  return runs;
}

export async function prepareToolDraft(
  input: Parameters<typeof buildToolDraft>[0] & { retry?: boolean },
): Promise<ToolDraftProposal | null> {
  const base = await buildToolDraft(input);
  if (!base) return null;
  const history = await draftHistory(base, input.retry);
  const last = history.at(-1);
  const next = input.retry && last && retryableRun(last);
  const attemptNumber = Math.max(1, history.length + (next ? 1 : 0));
  return {
    ...base,
    runId: attemptId(base.runId, attemptNumber),
    attemptNumber,
    ...(attemptNumber > 1
      ? { previousRunId: attemptId(base.runId, attemptNumber - 1) }
      : {}),
  };
}

export type ToolDraftOutcome = {
  status: "committed" | "failed" | "effect_unknown" | "denied" | "busy";
  execution?: ToolExecutionRecord;
  retryable?: boolean;
};
export interface ToolDraftContext {
  /** Host rechecks active branch, mode, setting and current write capability. */
  currentCall: () => ToolCall | null;
  authorized: () => boolean;
}

export async function readToolDraftOutcome(
  proposal: ToolDraftProposal,
): Promise<ToolDraftOutcome | null> {
  const persistence = getAgentRunPersistence();
  let hasEvidence = false;
  try {
    const history = await persistence.readDraftHistory(
      proposal.runId.replace(/-a[1-9][0-9]*$/, ""),
      proposal.sessionId,
    );
    hasEvidence = history.hasEvidence;
  } catch {
    return { status: "effect_unknown", retryable: false };
  }
  const run = await persistence.get(proposal.runId);
  const execution = run?.toolExecutions[0];
  if (!execution) return null;
  if (!persistence.getStatus().durable)
    return { status: "effect_unknown", retryable: false };
  if (execution.status === "committed") {
    const target = resolveWorkspaceUrl(proposal.sessionId, proposal.path);
    const receipt = execution.receipt;
    const references = execution.resultRefs;
    if (
      run!.status !== "completed" ||
      run!.sessionId !== proposal.sessionId ||
      run!.modelMessageId !== proposal.messageId ||
      execution.runId !== proposal.runId ||
      execution.callId !== proposal.runId ||
      execution.toolName !== "write_workspace_file" ||
      execution.definitionFingerprint !== "ui-workspace-draft:create:v1" ||
      execution.argumentsHash !== proposal.hash ||
      execution.targetSummary !== proposal.path ||
      !target.ok ||
      !receipt ||
      receipt.effectId !== proposal.runId ||
      receipt.targetHash !== (await hashToolArguments(proposal.path)) ||
      !receipt.resultHash ||
      references?.length !== 1 ||
      references[0].kind !== "workspace_file" ||
      references[0].id !== target.value.url ||
      references[0].contentHash !== receipt.resultHash
    )
      return { status: "effect_unknown", retryable: false };
  }
  return {
    status:
      execution.status === "committed"
        ? "committed"
        : execution.status === "failed"
          ? "failed"
          : "effect_unknown",
    execution,
    retryable: hasEvidence && retryableRun(run!),
  };
}

/** Confirmation lives only in the caller's current view; it is never persisted. */
export async function commitToolDraft(
  proposal: ToolDraftProposal,
  context: ToolDraftContext,
): Promise<ToolDraftOutcome> {
  if (!context.authorized() || !globalThis.navigator?.locks)
    return { status: "denied" };
  return runWithAppDataWriteLock(() =>
    navigator.locks.request(
      `intelligent-ui-draft:${proposal.sessionId}`,
      { ifAvailable: true },
      async (lock): Promise<ToolDraftOutcome> => {
        if (!lock) return { status: "busy" };
        const persistence = getAgentRunPersistence();
        const current = context.currentCall();
        if (!context.authorized() || !current) return { status: "denied" };
        const matchesCurrentResult = () => {
          const next = context.currentCall();
          return (
            !!next &&
            next.id === current.id &&
            next.name === current.name &&
            next.pluginId === current.pluginId &&
            next.executionRecordId === current.executionRecordId &&
            next.functionFingerprint === current.functionFingerprint &&
            next.status === "success" &&
            !next.isError &&
            next.result === current.result &&
            next.intelligentUiResult?.resultHash === proposal.resultHash
          );
        };
        const checked = await buildToolDraft({
          sessionId: proposal.sessionId,
          messageId: proposal.messageId,
          call: current,
          selectedIds: proposal.selectedIds,
          visibleColumns: proposal.visibleColumns,
          locale: proposal.locale,
        });
        if (!checked) return { status: "denied" };
        const { attemptNumber, previousRunId, ...binding } = proposal;
        const expected = { ...checked, attemptNumber: undefined };
        if (
          !Number.isSafeInteger(attemptNumber) ||
          attemptNumber < 1 ||
          JSON.stringify({ ...binding, runId: checked.runId }) !==
            JSON.stringify(expected) ||
          proposal.runId !== attemptId(checked.runId, attemptNumber) ||
          previousRunId !==
            (attemptNumber > 1
              ? attemptId(checked.runId, attemptNumber - 1)
              : undefined)
        )
          return { status: "denied" };
        let history: AgentRun[];
        try {
          history = await draftHistory(checked);
        } catch {
          return { status: "denied" };
        }
        if (
          attemptNumber > history.length + 1 ||
          (attemptNumber === history.length + 1 &&
            history.length &&
            !retryableRun(history.at(-1)!))
        )
          return { status: "denied" };
        const previous = await readToolDraftOutcome(proposal);
        if (previous)
          return history.length >= attemptNumber
            ? previous
            : { status: "denied" }; // Never replay an interrupted/unknown write.
        const sourceRuns = await persistence.list(proposal.sessionId);
        const source = sourceRuns
          .filter((run) => run.modelMessageId === proposal.messageId)
          .flatMap((run) => run.toolExecutions)
          .find(
            (execution) =>
              execution.id === proposal.sourceExecutionId &&
              execution.callId === proposal.callId &&
              execution.status === "committed" &&
              execution.toolName === current.name &&
              execution.pluginId === current.pluginId &&
              execution.definitionFingerprint ===
                proposal.definitionFingerprint &&
              execution.resultRefs?.some(
                (ref) =>
                  ref.kind === "tool_cache" &&
                  ref.contentHash === proposal.resultHash,
              ),
          );
        if (
          !source ||
          !context.authorized() ||
          !persistence.getStatus().durable
        )
          return { status: "denied" };
        const acquired = acquireAgentRunLease({
          sessionId: proposal.sessionId,
          runId: proposal.runId,
        });
        if (!acquired.acquired) return { status: "busy" };
        if (!acquired.durable) {
          releaseAgentRunLease(acquired.lease);
          return { status: "denied" };
        }
        let run = prepareToolExecution(
          createAgentRun({
            id: proposal.runId,
            sessionId: proposal.sessionId,
            modelMessageId: proposal.messageId,
          }),
          {
            callId: proposal.runId,
            toolName: "write_workspace_file",
            definitionFingerprint: "ui-workspace-draft:create:v1",
            argumentsHash: proposal.hash,
            targetSummary: proposal.path,
            policy: {
              effects: ["local_write"],
              idempotency: "idempotent",
              sensitivity: "user_data",
              origin: "builtin",
            },
          },
        );
        const executionId = run.toolExecutions[0].id;
        let dispatched = false;
        const denyBeforeDispatch = async (): Promise<ToolDraftOutcome> => {
          run = failToolExecution(run, executionId, {
            code: "action.confirmation_expired",
            message: "The current confirmation is no longer valid.",
            recoverable: true,
          });
          await persistence.save(
            transitionAgentRunStatus(run, "cancelled", {
              stop: { reason: "user_stopped" },
            }),
          );
          return {
            status: "denied",
            execution: run.toolExecutions[0],
            retryable: true,
          };
        };
        try {
          // A new attempt must still directly follow the durable history while
          // this tab owns both the session Web Lock and the Agent run lease.
          const leasedHistory = await draftHistory(checked, true);
          if (
            leasedHistory.length !== attemptNumber - 1 ||
            !persistence.getStatus().durable ||
            !context.authorized() ||
            !matchesCurrentResult()
          )
            return { status: "denied" };
          checkpointAgentRunLease(acquired.lease);
          await persistence.save(run);
          // Persist the dispatch boundary before touching OPFS, and recheck view authority.
          if (!context.authorized() || !matchesCurrentResult())
            return await denyBeforeDispatch();
          checkpointAgentRunLease(acquired.lease);
          run = markToolExecutionRunning(run, executionId);
          await persistence.save(run);
          if (
            !context.authorized() ||
            !matchesCurrentResult() ||
            !persistence.getStatus().durable
          )
            return await denyBeforeDispatch();
          dispatched = true;
          const result = await writeWorkspaceText(
            proposal.sessionId,
            proposal.path,
            proposal.content,
            "create",
            {
              beforeWrite: () => {
                if (
                  !context.authorized() ||
                  !matchesCurrentResult() ||
                  !persistence.getStatus().durable
                )
                  return false;
                try {
                  checkpointAgentRunLease(acquired.lease);
                  return true;
                } catch {
                  return false;
                }
              },
            },
          );
          if (!result.ok) {
            if (!SAFE_PREWRITE_ERRORS.has(result.error.code)) {
              run = markToolExecutionEffectUnknown(run, executionId, {
                code: "action.effect_unknown",
                message:
                  "The write or its metadata may be incomplete; inspect the workspace.",
              });
              await persistence.save(
                transitionAgentRunStatus(run, "failed", {
                  stop: { reason: "effect_unknown" },
                }),
              );
              return {
                status: "effect_unknown",
                execution: run.toolExecutions[0],
              };
            }
            run = failToolExecution(run, executionId, {
              code: result.error.code,
              message: "Workspace draft was not written.",
              recoverable: true,
            });
            await persistence.save(
              transitionAgentRunStatus(run, "failed", {
                stop: { reason: "runtime_error" },
              }),
            );
            return {
              status: "failed",
              execution: run.toolExecutions[0],
              retryable: true,
            };
          }
          run = commitToolExecution(run, executionId, {
            resultRefs: [
              {
                kind: "workspace_file",
                id: result.value.url,
                contentHash: result.value.contentHash,
              },
            ],
            receipt: {
              committedAt: Date.now(),
              effectId: proposal.runId,
              targetHash: await hashToolArguments(proposal.path),
              resultHash: result.value.contentHash,
              reversible: true,
            },
          });
          await persistence.save(
            transitionAgentRunStatus(run, "completed", {
              stop: { reason: "completed" },
            }),
          );
          if (!persistence.getStatus().durable)
            return { status: "effect_unknown" };
          return { status: "committed", execution: run.toolExecutions[0] };
        } catch {
          if (dispatched && run.toolExecutions[0].status === "running") {
            run = markToolExecutionEffectUnknown(run, executionId, {
              code: "action.effect_unknown",
              message: "Inspect the workspace before retrying.",
            });
            await persistence
              .save(
                transitionAgentRunStatus(run, "failed", {
                  stop: { reason: "effect_unknown" },
                }),
              )
              .catch(() => undefined);
          }
          return { status: dispatched ? "effect_unknown" : "failed" };
        } finally {
          releaseAgentRunLease(acquired.lease);
        }
      },
    ),
  ).catch(() => ({ status: "denied" as const }));
}
