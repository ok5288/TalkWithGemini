"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { API_INPUT_LIMITS } from "@/config/limits";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import {
  getActiveUiSourceContextKey,
  createActiveUiSourceScope,
  resolveBlockUiProjectionData,
} from "@/lib/intelligentUi/sourceContext";
import type { UiChatSend } from "@/components/content/intelligentUi/UiChatContext";
import type { UiSendResult } from "@/lib/intelligentUi/bridgeTypes";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { matchesUiStateTarget } from "@/lib/intelligentUi/instance";
import { useSettingsStore } from "@/store/core/settingsStore";
import { isTemporarySessionId } from "@/lib/chat/sessionRetention";
import { v7 as uuidv7 } from "uuid";
import type { ComposerForcedInvocations } from "@/components/chat/MessageInput";
import type { ComposerSkillParameterValues } from "@/components/skill/SkillParameterDialog";
import type { Attachment, Message, MessageReplyReference } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { resolveSkillsForMessage } from "@/services/api/skillService";
import { handleTokenUsageUpdate } from "@/lib/utils/message";
import {
  createBotMessagePlaceholder,
  getModelDisplayName,
} from "@/lib/chat/messageProcessor";
import {
  createSessionPostGenerationSnapshot,
  shouldApplyCompressionUpdate,
  shouldApplyGeneratedTitle,
  shouldApplySuggestedQuestions,
} from "@/lib/chat/postGenerationGuards";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import { buildSearchUpdate } from "@/lib/chat/searchUpdate";
import {
  createStreamCheckpointController,
  runWithPreOutputRetry,
} from "@/lib/chat/streamResilience";
import type { StreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";
import { getSyncDeviceId } from "@/lib/sync/deviceIdentity";
import {
  isForcedPluginInvocationError,
  mergeForcedPluginIds,
} from "@/lib/chat/forcedInvocation";
import { logDevError } from "@/lib/utils/devLogger";
import type { ChatFlowDeps, StreamRenderSnapshot } from "./chatFlowTypes";

const logChatAppError = logDevError;
const loadChatService = () => import("@/services/api/chatService");

/** Composer send: user message -> placeholder -> stream -> post-generation. */
export function useSendMessageFlow(deps: ChatFlowDeps) {
  const {
    t,
    locale,
    showActionError,
    sessions,
    system,
    selectedModel,
    chatConfig,
    modelMetadata,
    customModelMetadata,
    availableModels,
    installedSkills,
    skillBundles,
    activeSkillBundleIds,
    skillAutoSelect,
    isGenerating,
    createSession,
    addMessage,
    updateMessage,
    updateMessageContent,
    setSuggestedQuestions,
    updateSessionTitle,
    updateSessionCompression,
    syncActiveSession,
    beginActiveGeneration,
    isGenerationRunActive,
    finishActiveGeneration,
    abortBackgroundPostProcessing,
    beginBackgroundPostProcessing,
    queueMemoryExtraction,
    createMessageStreamRenderer,
    activeStreamRenderRef,
    activeStreamCheckpointRef,
    persistLongTextFilesForMessage,
    toolConfirmationController,
    agentUserInputController,
    prepareComposerSkillParameters,
    processPromptForModel,
    createAgentToolStreamOptions,
    commitInjectedMemoryContext,
  } = deps;

  const currentModels = useRef(availableModels);
  useLayoutEffect(() => {
    currentModels.current = availableModels;
  }, [availableModels]);
  const sending = useRef(false);
  const [uiSendProposal, setUiSendProposal] = useState<{
    id: string;
    text: string;
    context: string;
    saving: boolean;
    saveFailed: boolean;
  } | null>(null);
  const pendingUiSend = useRef<{
    id: string;
    validate: () => UiSendResult | undefined;
    acknowledge: (result: UiSendResult) => void;
    send?: () => Promise<void>;
  } | null>(null);
  const cancelUiSend = (
    result: UiSendResult = { ok: false, code: "cancelled" },
  ) => {
    const pending = pendingUiSend.current;
    pendingUiSend.current = null;
    setUiSendProposal(null);
    pending?.acknowledge(result);
  };
  useEffect(() => {
    const check = () => {
      const invalid = pendingUiSend.current?.validate();
      if (invalid) cancelUiSend(invalid);
    };
    const unsubscribeChat = useChatStore.subscribe?.(check);
    const unsubscribeSettings = useSettingsStore.subscribe?.(check);
    const timer = window.setInterval(check, 100);
    return () => {
      unsubscribeChat?.();
      unsubscribeSettings?.();
      window.clearInterval(timer);
      const pending = pendingUiSend.current;
      pendingUiSend.current = null;
      pending?.acknowledge({ ok: false, code: "inactive" });
    };
  }, []);
  const confirmUiSend = async () => {
    const pending = pendingUiSend.current;
    if (!pending?.send || sending.current) return;
    const invalid = pending.validate();
    if (invalid) {
      cancelUiSend(invalid);
      return;
    }
    sending.current = true;
    setUiSendProposal(
      (current) => current && { ...current, saving: true, saveFailed: false },
    );
    try {
      await waitForSessionMessageWrites(
        useChatStore.getState().currentSessionId!,
      );
    } catch {
      sending.current = false;
      if (pendingUiSend.current === pending)
        setUiSendProposal(
          (current) =>
            current && { ...current, saving: false, saveFailed: true },
        );
      return;
    }
    if (pendingUiSend.current !== pending) {
      sending.current = false;
      return;
    }
    const stale = pending.validate();
    if (stale) {
      sending.current = false;
      cancelUiSend(stale);
      return;
    }
    pendingUiSend.current = null;
    setUiSendProposal(null);
    try {
      await pending.send();
    } catch {
      pending.acknowledge({ ok: false, code: "send_failed" });
    } finally {
      sending.current = false;
      pending.acknowledge({ ok: false, code: "send_failed" });
    }
  };
  const runSendMessage = async (
    text: string,
    attachments: Attachment[],
    replyTo?: MessageReplyReference,
    skillParameters?: ComposerSkillParameterValues,
    forced?: ComposerForcedInvocations,
    ui?: {
      validate: () => UiSendResult | undefined;
      validateSources: () => Promise<UiSendResult | undefined>;
      assertDispatch: (appendedIds: readonly string[]) => Promise<void>;
      acknowledge: (result: UiSendResult) => void;
      context: () =>
        { messageId: string; blockId: string; content: string } | undefined;
    },
  ) => {
    const chatState = useChatStore.getState();
    if (!navigator.onLine) {
      showActionError(t("offlineReadOnly"));
      return;
    }
    if (
      (!text.trim() && attachments.length === 0) ||
      isGenerating ||
      chatState.isActiveSessionLoading
    ) {
      return;
    }

    let targetSessionId = chatState.currentSessionId;

    if (!targetSessionId) {
      const pendingSessionSkillIds = forced?.pendingSessionSkillIds;
      targetSessionId = createSession(
        undefined,
        "New Chat",
        undefined,
        [],
        pendingSessionSkillIds?.length
          ? { activeSkills: pendingSessionSkillIds }
          : undefined,
      );
    }

    if (!targetSessionId) return;
    if (isTemporarySessionId(targetSessionId)) {
      attachments = [];
      forced = undefined;
    }

    // Auto-rename check
    let shouldAutoRename = false;
    let sessionForCheck = sessions.find((s) => s.id === targetSessionId);

    if (!sessionForCheck) {
      sessionForCheck = useChatStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId);
    }

    if (
      system.enableAutoTitle &&
      sessionForCheck &&
      sessionForCheck.messageCount === 0 &&
      sessionForCheck.title === "New Chat"
    ) {
      shouldAutoRename = true;
    }

    const resolvedSkillParameters =
      skillParameters ||
      (await prepareComposerSkillParameters(
        sessionForCheck,
        selectedModel,
        [],
        !!ui,
      ));
    if (!resolvedSkillParameters) {
      ui?.acknowledge({ ok: false, code: "user_action_required" });
      return;
    }
    const invalidAfterPreparation =
      ui && ((await ui.validateSources()) ?? ui.validate());
    if (invalidAfterPreparation) {
      ui?.acknowledge(invalidAfterPreparation);
      return;
    }

    abortBackgroundPostProcessing();
    const generation = beginActiveGeneration();

    const modelDisplayName = getModelDisplayName(
      selectedModel,
      availableModels,
    );

    let botMsgId: string | null = null;
    let userMessageAdded = false;
    let startTime = Date.now();
    let receivedVisibleOutput = false;
    let receivedToolActivity = false;
    let streamCheckpoint: ReturnType<
      typeof createStreamCheckpointController
    > | null = null;
    let streamRenderer: StreamRenderScheduler<StreamRenderSnapshot> | null =
      null;
    const requestedPluginIds = mergeForcedPluginIds([], forced?.pluginIds);

    try {
      // Process message and attachments
      const sessionForProcessing =
        useChatStore
          .getState()
          .sessions.find((s) => s.id === targetSessionId) || sessionForCheck;
      const processedData = await processPromptForModel(
        sessionForProcessing,
        text,
        attachments,
        generation.controller.signal,
        undefined,
        replyTo,
        selectedModel,
      );

      const {
        finalText,
        researchLaunchText,
        researchPendingPlanTaskId,
        finalAttachments,
        ragSources,
        ragError,
        userMessage,
        injectedMemoryIds,
      } = processedData;

      if (requestedPluginIds.length > 0) {
        userMessage.forcedPluginIds = requestedPluginIds;
      }

      if (!isGenerationRunActive(generation)) return;
      const invalidSource =
        ui && ((await ui.validateSources()) ?? ui.validate());
      if (invalidSource) {
        ui?.acknowledge(invalidSource);
        return;
      }
      const intelligentUiSource = ui?.context();
      commitInjectedMemoryContext(
        targetSessionId,
        sessionForProcessing,
        injectedMemoryIds,
      );

      // addMessage publishes synchronously before durable storage completes.
      // A persistence rejection must not invite a duplicate SDK retry.
      const insertionPath = useChatStore
        .getState()
        .activeMessages.map((message) => message.id);
      const acknowledgeLiveInsertion = () => {
        const state = useChatStore.getState();
        if (
          state.currentSessionId === targetSessionId &&
          state.activeMessages.length === insertionPath.length + 1 &&
          insertionPath.every(
            (id, index) => state.activeMessages[index]?.id === id,
          ) &&
          state.activeMessages.at(-1)?.id === userMessage.id &&
          state.activeMessages.at(-1)?.role === "user"
        ) {
          userMessageAdded = true;
          ui?.acknowledge({ ok: true, messageId: userMessage.id });
        }
      };
      const insertion = addMessage(targetSessionId, userMessage);
      if (ui) acknowledgeLiveInsertion();
      try {
        await insertion;
      } catch (error) {
        if (ui) {
          acknowledgeLiveInsertion();
          if (userMessageAdded) {
            showActionError(
              error instanceof Error ? error.message : String(error),
            );
            return;
          }
        }
        throw error;
      }
      if (ui) {
        acknowledgeLiveInsertion();
        if (!userMessageAdded) {
          ui.acknowledge(ui.validate() ?? { ok: false, code: "send_failed" });
          return;
        }
      } else userMessageAdded = true;
      if (!isGenerationRunActive(generation)) return;

      // Add Placeholder Bot Message
      const botMsg = createBotMessagePlaceholder(
        modelDisplayName,
        ragSources,
        ragError,
      );
      const currentBotMsgId = botMsg.id;
      botMsgId = currentBotMsgId;
      startTime = botMsg.timestamp;
      const agentRequestId = uuidv7();
      botMsg.generation = {
        status: "streaming",
        requestId: agentRequestId,
        ...(processedData.effectiveContext.agentModeEnabled
          ? { agentRunId: agentRequestId }
          : {}),
        ownerDeviceId: getSyncDeviceId(),
        model: selectedModel,
        attempt: 0,
        checkpointAt: startTime,
      };

      await addMessage(targetSessionId, botMsg);
      if (!isGenerationRunActive(generation)) return;
      const beforeDispatch = ui
        ? async () => {
            try {
              const assertGeneration = () => {
                if (
                  !isGenerationRunActive(generation) ||
                  useChatStore
                    .getState()
                    .activeMessages.find(
                      (message) => message.id === currentBotMsgId,
                    )?.generation?.requestId !== agentRequestId
                )
                  throw new Error("UI_SOURCE_STALE");
              };
              assertGeneration();
              await ui.assertDispatch([userMessage.id, currentBotMsgId]);
              assertGeneration();
            } catch {
              throw Object.assign(
                new Error(t("intelligentUiAuthorizationExpired")),
                { code: "UI_SOURCE_STALE" },
              );
            }
          }
        : undefined;
      await beforeDispatch?.();

      // Get fresh session data
      const historyMessages = useChatStore.getState().activeMessages;
      const freshSession = useChatStore
        .getState()
        .sessions.find((s) => s.id === targetSessionId);

      if (!freshSession) throw new Error("Session not found");
      const effectiveContext = processedData.effectiveContext;

      // Give the agent real files to work on: text attachments are copied into
      // the session workspace so run_javascript and the workspace tools can
      // reach them. Seeding must never block the message from being sent.
      if (effectiveContext.agentModeEnabled && finalAttachments.length > 0) {
        try {
          const { seedWorkspaceAttachments } =
            await import("@/services/workspace/seedAttachments");
          await seedWorkspaceAttachments(targetSessionId, finalAttachments);
        } catch (error) {
          logDevError("Failed to seed workspace attachments", error);
        }
      }

      // Prepare History for LLM (excluding the just-added user message)
      // Filter out the user message we just added since it will be sent separately
      const historyWithoutCurrentUser = historyMessages.filter(
        (m) => m.id !== userMessage.id,
      );

      const { prepareHistoryForLLM, streamChatResponse } =
        await loadChatService();
      const historyForLLM = await prepareHistoryForLLM(
        historyWithoutCurrentUser,
        freshSession.compression,
        selectedModel,
      );
      if (!isGenerationRunActive(generation)) return;

      await beforeDispatch?.();

      const effectiveConfig = resolveEffectiveChatRequestConfig({
        chatConfig,
        selectedModel,
        modelMetadata,
        customModelMetadata,
        searchCompatibility: effectiveContext.searchCompatibility,
      });
      const skillResolution = isTemporarySessionId(targetSessionId)
        ? {
            context: "",
            appliedSkills: [],
            invocations: [],
            skippedSkillIds: [],
          }
        : await resolveSkillsForMessage({
            message: text,
            selectedModel,
            locale,
            installedSkills,
            // Agent mode loads auto Skills through load_skill. Only explicit
            // slash references are injected directly for the current turn.
            activeSkillIds: effectiveContext.orchestratedModeEnabled
              ? []
              : effectiveContext.activeSkillIds,
            skillBundles,
            activeSkillBundleIds: effectiveContext.researchModeEnabled
              ? []
              : activeSkillBundleIds,
            skillParameterValues: resolvedSkillParameters.skillParameterValues,
            skillBundleParameterValues:
              resolvedSkillParameters.skillBundleParameterValues,
            autoSelect:
              skillAutoSelect && !effectiveContext.orchestratedModeEnabled,
            forcedSkillIds: effectiveContext.researchModeEnabled
              ? undefined
              : forced?.skillIds,
            signal: generation.controller.signal,
          });
      if (!isGenerationRunActive(generation)) return;
      await beforeDispatch?.();
      if (skillResolution.skippedSkillIds.length > 0) {
        showActionError(
          t("skillsSkipped", {
            count: skillResolution.skippedSkillIds.length,
          }),
        );
      }

      if (skillResolution.invocations.length > 0) {
        updateMessage(targetSessionId, currentBotMsgId, {
          skillInvocations: skillResolution.invocations,
        });
      }

      let latestStreamText = "";
      let latestStreamReasoning: string | undefined;
      let latestStreamOutputBlocks: Message["outputBlocks"];

      streamRenderer = createMessageStreamRenderer(
        targetSessionId,
        currentBotMsgId,
      );
      activeStreamRenderRef.current = streamRenderer;

      streamCheckpoint = createStreamCheckpointController({
        persist: async () => {
          streamRenderer?.flush();
          const message = useChatStore
            .getState()
            .activeMessages.find((item) => item.id === currentBotMsgId);
          if (message?.generation) {
            updateMessage(targetSessionId!, currentBotMsgId, {
              generation: {
                ...message.generation,
                checkpointAt: Date.now(),
              },
            });
          }
          await useChatStore.getState().syncActiveSession(targetSessionId!);
        },
      });
      activeStreamCheckpointRef.current = streamCheckpoint;

      await runWithPreOutputRetry({
        signal: generation.controller.signal,
        hasVisibleOutput: () => receivedVisibleOutput,
        hasToolActivity: () => receivedToolActivity,
        onAttempt: (attempt) => {
          const message = useChatStore
            .getState()
            .activeMessages.find((item) => item.id === currentBotMsgId);
          if (message?.generation) {
            updateMessage(targetSessionId!, currentBotMsgId, {
              generation: { ...message.generation, attempt },
            });
          }
        },
        run: async () => {
          await beforeDispatch?.();
          return streamChatResponse(
            targetSessionId!,
            selectedModel,
            historyForLLM,
            finalText,
            finalAttachments,
            effectiveConfig,
            (streamText, streamReasoning, outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              latestStreamText = streamText;
              if (streamReasoning !== undefined) {
                latestStreamReasoning = streamReasoning;
              }
              if (outputBlocks !== undefined) {
                latestStreamOutputBlocks = outputBlocks;
              }
              receivedVisibleOutput =
                receivedVisibleOutput ||
                Boolean(streamText || streamReasoning || outputBlocks?.length);
              streamRenderer?.schedule({
                content: latestStreamText,
                reasoning: latestStreamReasoning,
                outputBlocks: latestStreamOutputBlocks,
              });
              streamCheckpoint?.record(
                latestStreamText.length + (latestStreamReasoning?.length || 0),
              );
            },
            effectiveContext.systemInstruction,
            (isSearching, results) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput = receivedVisibleOutput || isSearching;
              const currentMessage = useChatStore
                .getState()
                .activeMessages.find(
                  (message) => message.id === currentBotMsgId,
                );
              const updates = buildSearchUpdate(
                currentMessage,
                isSearching,
                results,
                {
                  replaceResults: effectiveContext.agentModeEnabled,
                },
              );
              updateMessage(targetSessionId!, currentBotMsgId, updates);
            },
            (toolCalls) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedToolActivity =
                receivedToolActivity || toolCalls.length > 0;
              updateMessage(targetSessionId!, currentBotMsgId, { toolCalls });
            },
            (images) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              receivedVisibleOutput =
                receivedVisibleOutput || images.length > 0;
              const currentActiveMsgs = useChatStore.getState().activeMessages;
              const msg = currentActiveMsgs.find(
                (m) => m.id === currentBotMsgId,
              );
              const currentAttachments = msg?.attachments || [];

              updateMessage(targetSessionId!, currentBotMsgId, {
                attachments: [...currentAttachments, ...images],
              });
            },
            (usage) => {
              if (!isGenerationRunActive(generation)) return;
              const currentMessages = useChatStore.getState().activeMessages;
              handleTokenUsageUpdate(
                usage,
                currentMessages,
                userMessage.id,
                currentBotMsgId,
                targetSessionId!,
                updateMessage,
              );
            },
            generation.controller.signal,
            effectiveContext.activePluginIds,
            skillResolution.context,
            (outputBlocks) => {
              if (!isGenerationRunActive(generation)) return;
              streamRenderer?.flush();
              latestStreamOutputBlocks = outputBlocks;
              receivedVisibleOutput =
                receivedVisibleOutput || outputBlocks.length > 0;
              updateMessageContent(
                targetSessionId!,
                currentBotMsgId,
                latestStreamText,
                latestStreamReasoning,
                outputBlocks,
              );
            },
            toolConfirmationController,
            {
              intelligentUiSource,
              beforeDispatch,
              userInputController: agentUserInputController,
              ...createAgentToolStreamOptions({
                sessionId: targetSessionId!,
                modelMessageId: currentBotMsgId,
                knowledgeScope: processedData.knowledgeScope,
                isActive: () => isGenerationRunActive(generation),
                allowedSkillIds: effectiveContext.agentSkillIds,
                allowedToolIds: effectiveContext.agentToolIds,
                approvalMode: effectiveContext.approvalMode,
                agentBudget: effectiveContext.agentBudget,
                memoryScopes: effectiveContext.memoryScopes,
                memoryScopeIds: effectiveContext.memoryScopeIds,
                agentRun: {
                  id: botMsg.generation!.requestId,
                  userMessageId: userMessage.id,
                  modelMessageId: currentBotMsgId,
                },
              }),
              researchLaunchMessage: researchLaunchText,
              ...(researchPendingPlanTaskId
                ? {
                    executionWorkflow: {
                      kind: "research" as const,
                      phase: "clarify" as const,
                    },
                    researchPendingTaskId: researchPendingPlanTaskId,
                  }
                : {}),
              forcedPluginIds: requestedPluginIds,
            },
          );
        },
      });

      streamRenderer.flush();
      if (!isGenerationRunActive(generation)) return;
      await persistLongTextFilesForMessage(targetSessionId, currentBotMsgId, {
        expectedRequestId: botMsg.generation.requestId,
        signal: generation.controller.signal,
      });
      if (!isGenerationRunActive(generation)) return;
      const endTime = Date.now();
      const completedGeneration = useChatStore
        .getState()
        .activeMessages.find(
          (message) => message.id === currentBotMsgId,
        )?.generation;
      updateMessage(targetSessionId, currentBotMsgId, {
        generation: {
          ...(completedGeneration || botMsg.generation!),
          status: "completed",
          checkpointAt: endTime,
        },
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      });
      await streamCheckpoint.flush();

      // --- Post-Generation ---
      // Force sync active messages to storage at end of generation
      await syncActiveSession(targetSessionId);
      if (!isGenerationRunActive(generation)) return;

      const postGenerationState = useChatStore.getState();
      const postGenerationSession = postGenerationState.sessions.find(
        (session) => session.id === targetSessionId,
      );
      const postGenerationSnapshot = createSessionPostGenerationSnapshot(
        postGenerationSession,
      );
      const isTargetSessionActive =
        postGenerationState.currentSessionId === targetSessionId;
      const updatedHistory = isTargetSessionActive
        ? postGenerationState.activeMessages
        : [];
      const completedBotMessage = isTargetSessionActive
        ? updatedHistory.find((message) => message.id === currentBotMsgId)
        : undefined;
      const suggestedQuestionSnapshot = completedBotMessage
        ? {
            id: completedBotMessage.id,
            content: completedBotMessage.content,
          }
        : null;
      const postProcessSignal = beginBackgroundPostProcessing();

      if (completedBotMessage) {
        queueMemoryExtraction(
          targetSessionId,
          userMessage,
          {
            id: completedBotMessage.id,
            content: completedBotMessage.content,
          },
          postProcessSignal,
        );
      }

      // 1. Follow-up Questions
      if (system.enableRelatedQuestions && updatedHistory.length > 0) {
        loadChatService()
          .then(({ generateRelatedQuestions }) =>
            generateRelatedQuestions(updatedHistory, postProcessSignal),
          )
          .then((questions) => {
            if (postProcessSignal.aborted) return;
            const state = useChatStore.getState();
            const currentMessage =
              state.currentSessionId === targetSessionId
                ? state.activeMessages.find(
                    (message) => message.id === currentBotMsgId,
                  )
                : undefined;
            if (
              questions &&
              questions.length > 0 &&
              shouldApplySuggestedQuestions(
                currentMessage,
                suggestedQuestionSnapshot,
              )
            ) {
              setSuggestedQuestions(
                targetSessionId!,
                currentBotMsgId,
                questions,
              );
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Related question generation failed:", err);
          });
      }

      // 2. Auto-Rename
      if (shouldAutoRename && updatedHistory.length > 0) {
        loadChatService()
          .then(({ generateChatTitle }) =>
            generateChatTitle(updatedHistory, postProcessSignal),
          )
          .then((newTitle) => {
            if (postProcessSignal.aborted) return;
            const currentSession = useChatStore
              .getState()
              .sessions.find((session) => session.id === targetSessionId);
            if (
              newTitle &&
              shouldApplyGeneratedTitle(currentSession, postGenerationSnapshot)
            ) {
              updateSessionTitle(targetSessionId!, newTitle);
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Chat title generation failed:", err);
          });
      }

      // 3. Auto-Compress
      if (
        system.enableAutoCompression &&
        postGenerationSession &&
        updatedHistory.length > 0
      ) {
        loadChatService()
          .then(({ performBackgroundCompression }) =>
            performBackgroundCompression(
              updatedHistory,
              postGenerationSession.compression,
              selectedModel,
              postProcessSignal,
            ),
          )
          .then((newCompression) => {
            if (postProcessSignal.aborted) return;
            const currentSession = useChatStore
              .getState()
              .sessions.find((session) => session.id === targetSessionId);
            if (
              newCompression &&
              shouldApplyCompressionUpdate(
                currentSession,
                postGenerationSnapshot,
              )
            ) {
              updateSessionCompression(targetSessionId!, newCompression);
            }
          })
          .catch((err) => {
            if (postProcessSignal.aborted) return;
            logChatAppError("Context compression failed:", err);
          });
      }
    } catch (error: any) {
      // A rejected SDK preparation must not create a fallback turn: the caller
      // receives a failure receipt and may explicitly retry from its UI.
      if (ui && !userMessageAdded) {
        ui.acknowledge(ui.validate() ?? { ok: false, code: "send_failed" });
        return;
      }
      streamRenderer?.flush();
      if (error.name === "AbortError" || generation.controller.signal.aborted) {
        return;
      } else {
        logChatAppError("Generating content failed:", error);
        let errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred.";
        if (typeof error === "object" && error !== null && "message" in error) {
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        }
        const sourceRevoked = !!ui && error?.code === "UI_SOURCE_STALE";
        const forcedPluginFailure = isForcedPluginInvocationError(error);
        const errorCode =
          typeof error?.code === "string" ? error.code : undefined;

        if (!userMessageAdded) {
          const fallbackUserMessage: Message = {
            id: uuidv7(),
            role: "user",
            content: text,
            timestamp: Date.now(),
            attachments,
            replyTo,
            ...(requestedPluginIds.length > 0
              ? { forcedPluginIds: requestedPluginIds }
              : {}),
          };
          await addMessage(targetSessionId, fallbackUserMessage);
          userMessageAdded = true;
        }

        if (botMsgId) {
          const partialMessage = useChatStore
            .getState()
            .activeMessages.find((message) => message.id === botMsgId);
          const hasPartialOutput = Boolean(
            partialMessage?.content ||
            partialMessage?.reasoning ||
            partialMessage?.outputBlocks?.length,
          );
          updateMessage(targetSessionId, botMsgId, {
            generation: partialMessage?.generation
              ? {
                  ...partialMessage.generation,
                  status: "interrupted",
                  checkpointAt: Date.now(),
                }
              : undefined,
            generationError:
              hasPartialOutput && !forcedPluginFailure && !sourceRevoked
                ? undefined
                : {
                    message: errorMessage,
                    recoverable: !sourceRevoked,
                    ...(errorCode ? { code: errorCode } : {}),
                  },
            timing: {
              startTime,
              endTime: Date.now(),
              duration: Date.now() - startTime,
            },
          });
        } else {
          const errorBotMsg = createBotMessagePlaceholder(modelDisplayName, []);
          errorBotMsg.content = "";
          errorBotMsg.generationError = {
            message: errorMessage,
            recoverable: true,
            ...(errorCode ? { code: errorCode } : {}),
          };
          errorBotMsg.timing = {
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
          };
          await addMessage(targetSessionId, errorBotMsg);
        }

        await streamCheckpoint?.flush();
        await syncActiveSession(targetSessionId); // Sync error message too
      }
    } finally {
      streamRenderer?.cancel();
      if (activeStreamRenderRef.current === streamRenderer) {
        activeStreamRenderRef.current = null;
      }
      if (activeStreamCheckpointRef.current === streamCheckpoint) {
        activeStreamCheckpointRef.current = null;
      }
      finishActiveGeneration(generation);
    }
  };

  const handleSendMessage = async (
    ...args: [
      text: string,
      attachments: Attachment[],
      replyTo?: MessageReplyReference,
      skillParameters?: ComposerSkillParameterValues,
      forced?: ComposerForcedInvocations,
    ]
  ) => {
    cancelUiSend({ ok: false, code: "inactive" });
    if (sending.current) return;
    sending.current = true;
    try {
      await runSendMessage(...args);
    } finally {
      sending.current = false;
    }
  };

  const handleUiSendMessage: UiChatSend = (text, source) => {
    if (pendingUiSend.current || sending.current || isGenerating)
      return Promise.resolve({ ok: false, code: "busy" });
    const initialState = useChatStore.getState();
    const authority = getActiveUiSourceContextKey(
      source.sessionId,
      source.messageId,
    );
    const branch = initialState.activeMessages
      .map((message) => message.id)
      .join("\n");
    const validate = (): UiSendResult | undefined => {
      const state = useChatStore.getState();
      if (!text.trim() || text.length > API_INPUT_LIMITS.maxChatTextChars)
        return { ok: false, code: "invalid_message" };
      if (!navigator.onLine) return { ok: false, code: "offline" };
      if (
        !selectedModel ||
        state.selectedModel !== selectedModel ||
        !currentModels.current.some((model) => model.name === selectedModel)
      )
        return { ok: false, code: "model_unavailable" };
      if (
        !useSettingsStore.getState().system.enableIntelligentUi ||
        !source.isActive() ||
        getActiveUiSourceContextKey(source.sessionId, source.messageId) !==
          authority ||
        state.currentSessionId !== source.sessionId ||
        state.isActiveSessionLoading ||
        state.pendingSessionId ||
        state.activeMessages.map((message) => message.id).join("\n") !== branch
      )
        return { ok: false, code: "inactive" };
      if (
        state.activeMessages.some(
          (message) => message.generation?.status === "streaming",
        )
      )
        return { ok: false, code: "busy" };
      const block = state.activeMessages
        .find((message) => message.id === source.messageId)
        ?.outputBlocks?.find((block) => block.id === source.blockId);
      if (
        block?.type !== "intelligent_ui" ||
        !matchesUiStateTarget(block, source.blockId, source.definitionRevision)
      )
        return { ok: false, code: "inactive" };
    };
    const invalid = validate();
    if (invalid) return Promise.resolve(invalid);
    const block = initialState.activeMessages
      .find((message) => message.id === source.messageId)
      ?.outputBlocks?.find((block) => block.id === source.blockId);
    if (block?.type !== "intelligent_ui")
      return Promise.resolve({ ok: false, code: "inactive" });
    // The host captures content before any asynchronous source reads or user confirmation.
    const frozenBlock = structuredClone(block);
    return new Promise<UiSendResult>((acknowledge) => {
      const pending = {
        id: uuidv7(),
        validate,
        acknowledge,
        send: undefined as (() => Promise<void>) | undefined,
      };
      pendingUiSend.current = pending;
      void (async () => {
        const scope = await createActiveUiSourceScope(
          source.sessionId,
          source.messageId,
        );
        const data = await resolveBlockUiProjectionData(
          frozenBlock,
          source.sessionId,
          source.messageId,
          "model-continuation",
          scope,
        );
        await scope.assertValid();
        return { data, scope };
      })()
        .then(({ data, scope }) => {
          if (pendingUiSend.current !== pending) return;
          const stale = validate();
          if (stale) {
            cancelUiSend(stale);
            return;
          }
          const content = projectUiBlock(frozenBlock, {
            purpose: "model-continuation",
            locale,
            ...data,
          });
          const context = Object.freeze({
            messageId: source.messageId,
            blockId: source.blockId,
            content,
          });
          pending.send = () =>
            runSendMessage(text, [], undefined, undefined, undefined, {
              validate,
              validateSources: async () => {
                try {
                  await scope.assertValid();
                  return validate();
                } catch {
                  return { ok: false, code: "inactive" };
                }
              },
              assertDispatch: async (appendedIds) => {
                const assertHost = () => {
                  const state = useChatStore.getState();
                  if (
                    !(source.isInstanceActive ?? source.isActive)() ||
                    !navigator.onLine ||
                    !useSettingsStore.getState().system.enableIntelligentUi ||
                    state.selectedModel !== selectedModel ||
                    !currentModels.current.some(
                      (model) => model.name === selectedModel,
                    )
                  )
                    throw new Error("UI_SOURCE_STALE");
                  const current = state.activeMessages
                    .find((message) => message.id === source.messageId)
                    ?.outputBlocks?.find((item) => item.id === source.blockId);
                  if (
                    current?.type !== "intelligent_ui" ||
                    !matchesUiStateTarget(
                      current,
                      source.blockId,
                      source.definitionRevision,
                    )
                  )
                    throw new Error("UI_SOURCE_STALE");
                };
                assertHost();
                await scope.assertDispatchValid(appendedIds);
                assertHost();
              },
              acknowledge,
              context: () => context,
            });
          setUiSendProposal({
            id: pending.id,
            text,
            context: content,
            saving: false,
            saveFailed: false,
          });
        })
        .catch(() => {
          if (pendingUiSend.current === pending)
            cancelUiSend({ ok: false, code: "send_failed" });
        });
    });
  };

  const prepareComposerSend = async (forced?: ComposerForcedInvocations) => {
    if (sending.current || isGenerating) return null;
    sending.current = true;
    try {
      const state = useChatStore.getState();
      if (
        state.activeMessages.some(
          (message) => message.generation?.status === "streaming",
        )
      )
        return null;
      return await prepareComposerSkillParameters(
        state.sessions.find((session) => session.id === state.currentSessionId),
        selectedModel,
        [
          ...(forced?.skillIds ?? []),
          ...(forced?.pendingSessionSkillIds ?? []),
        ],
      );
    } finally {
      sending.current = false;
    }
  };

  return {
    handleSendMessage,
    handleUiSendMessage,
    prepareComposerSend,
    uiSendProposal,
    confirmUiSend,
    cancelUiSend,
  };
}
