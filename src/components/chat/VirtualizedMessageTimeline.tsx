"use client";

import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import AssistantHeader from "@/components/assistant/AssistantHeader";
import FollowUpQuestions from "@/components/chat/FollowUpQuestions";
import MessageItem from "@/components/chat/MessageItem";
import { getMessageBranchInfo } from "@/lib/chat/messageTree";
import type { ModelInfo } from "@/services/api/chatService";
import type {
  Message,
  Session,
  SessionMessageTree,
  ToolConfirmationDecision,
} from "@/types";

export interface VirtualizedMessageTimelineRef {
  scrollToMessage: (messageId: string, behavior?: "auto" | "smooth") => boolean;
  scrollToEnd: (behavior?: "auto" | "smooth") => void;
}

interface VirtualizedMessageTimelineProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentSession?: Session;
  messages: Message[];
  activeMessageTree: SessionMessageTree;
  focusedMessageId?: string;
  isGenerating: boolean;
  actionsDisabled: boolean;
  mutationsDisabled: boolean;
  availableModels: ModelInfo[];
  onUpdateInstruction: (instruction: string) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onSubmitUserEdit: (id: string, content: string) => void | Promise<void>;
  onRetract: (message: Message) => void;
  onRegenerate: (messageId: string, model?: string) => void;
  onContinue: (messageId: string) => void;
  onReply: (message: Message) => void;
  onNavigateToMessage: (messageId: string) => void;
  onVersionChange: (id: string, direction: "prev" | "next") => void;
  onSuggestionClick: (question: string) => void;
  onToolConfirmationDecision: (
    toolCallId: string,
    decision: ToolConfirmationDecision,
  ) => void;
  onRevokeToolSessionApproval: NonNullable<
    React.ComponentProps<typeof MessageItem>["onRevokeToolSessionApproval"]
  >;
  pendingToolMessageId?: string;
  onPendingToolVisibilityChange?: (visible: boolean) => void;
}

type TimelineRow =
  | { key: string; kind: "assistant" }
  | { key: string; kind: "message"; message: Message; messageIndex: number };

const estimateMessageSize = (message: Message) => {
  const textLength = message.content.length + (message.reasoning?.length || 0);
  const textHeight = Math.ceil(textLength / 72) * 24;
  const attachmentHeight = message.attachments?.length ? 120 : 0;
  return Math.min(720, Math.max(112, 88 + textHeight + attachmentHeight));
};

const FOLLOW_RESUME_DISTANCE_PX = 8;
const SCROLL_DIRECTION_EPSILON_PX = 1;

const VirtualizedMessageTimeline = React.forwardRef<
  VirtualizedMessageTimelineRef,
  VirtualizedMessageTimelineProps
>(
  (
    {
      scrollRef,
      currentSession,
      messages,
      activeMessageTree,
      focusedMessageId,
      isGenerating,
      actionsDisabled,
      mutationsDisabled,
      availableModels,
      onUpdateInstruction,
      onEdit,
      onDelete,
      onSubmitUserEdit,
      onRetract,
      onRegenerate,
      onContinue,
      onReply,
      onNavigateToMessage,
      onVersionChange,
      onSuggestionClick,
      onToolConfirmationDecision,
      onRevokeToolSessionApproval,
      pendingToolMessageId,
      onPendingToolVisibilityChange,
    },
    ref,
  ) => {
    const isFollowingRef = React.useRef(true);
    const isTouchingRef = React.useRef(false);
    const pausedByTouchGestureRef = React.useRef(false);
    const wasFollowingBeforeTouchRef = React.useRef(true);
    const touchStartClientYRef = React.useRef(0);
    const touchStartScrollTopRef = React.useRef(0);
    const previousScrollTopRef = React.useRef(0);
    const expectedFollowScrollTopRef = React.useRef<number | null>(null);
    const followFrameRef = React.useRef<number | null>(null);

    const rows = React.useMemo<TimelineRow[]>(() => {
      const nextRows: TimelineRow[] = [];
      if (
        currentSession &&
        (messages.length > 0 || currentSession.systemInstruction)
      ) {
        nextRows.push({
          key: `assistant-${currentSession.id}`,
          kind: "assistant",
        });
      }
      messages.forEach((message, messageIndex) => {
        nextRows.push({
          key: message.id,
          kind: "message",
          message,
          messageIndex,
        });
      });
      return nextRows;
    }, [currentSession, messages]);

    const messageRowIndex = React.useMemo(() => {
      const index = new Map<string, number>();
      rows.forEach((row, rowIndex) => {
        if (row.kind === "message") index.set(row.message.id, rowIndex);
      });
      return index;
    }, [rows]);

    const lastUserMessageIndex = React.useMemo(() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") return index;
      }
      return -1;
    }, [messages]);

    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      getItemKey: (index) => rows[index]?.key || index,
      estimateSize: (index) => {
        const row = rows[index];
        return row?.kind === "message" ? estimateMessageSize(row.message) : 96;
      },
      overscan: 8,
      anchorTo: "start",
      followOnAppend: false,
      paddingStart: 8,
      paddingEnd: 144,
      useFlushSync: false,
    });
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _delta,
      instance,
    ) =>
      !isFollowingRef.current &&
      item.end <= (scrollRef.current?.scrollTop ?? instance.scrollOffset ?? 0);

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const pendingToolRowIndex = pendingToolMessageId
      ? messageRowIndex.get(pendingToolMessageId)
      : undefined;
    const pendingToolVirtualRow =
      pendingToolRowIndex === undefined
        ? undefined
        : virtualItems.find((item) => item.index === pendingToolRowIndex);
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const viewportHeight =
      virtualizer.scrollRect?.height || scrollRef.current?.clientHeight || 0;
    const isPendingToolMessageVisible = Boolean(
      pendingToolVirtualRow &&
      pendingToolVirtualRow.end > scrollOffset &&
      pendingToolVirtualRow.start < scrollOffset + viewportHeight,
    );

    const cancelFollowFrame = React.useCallback(() => {
      if (followFrameRef.current === null) return;
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }, []);

    const scheduleFollowToEnd = React.useCallback(() => {
      if (
        !isFollowingRef.current ||
        isTouchingRef.current ||
        followFrameRef.current !== null
      ) {
        return;
      }
      followFrameRef.current = window.requestAnimationFrame(() => {
        followFrameRef.current = null;
        const scrollElement = scrollRef.current;
        if (
          !scrollElement ||
          !isFollowingRef.current ||
          isTouchingRef.current
        ) {
          return;
        }
        const targetScrollTop = Math.max(
          scrollElement.scrollHeight - scrollElement.clientHeight,
          0,
        );
        expectedFollowScrollTopRef.current = targetScrollTop;
        scrollElement.scrollTo({
          top: targetScrollTop,
          behavior: "auto",
        });
      });
    }, [scrollRef]);

    React.useEffect(() => {
      const scrollElement = scrollRef.current;
      cancelFollowFrame();
      isFollowingRef.current = true;
      isTouchingRef.current = false;
      expectedFollowScrollTopRef.current = null;
      previousScrollTopRef.current = scrollElement?.scrollTop ?? 0;
    }, [cancelFollowFrame, currentSession?.id, scrollRef]);

    React.useEffect(() => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;

      previousScrollTopRef.current = scrollElement.scrollTop;
      const pauseFollowing = () => {
        isFollowingRef.current = false;
        expectedFollowScrollTopRef.current = null;
        cancelFollowFrame();
      };
      const handleWheel = (event: WheelEvent) => {
        if (event.deltaY < 0) pauseFollowing();
      };
      const handleTouchStart = (event: TouchEvent) => {
        pausedByTouchGestureRef.current = false;
        wasFollowingBeforeTouchRef.current = isFollowingRef.current;
        touchStartClientYRef.current = event.touches[0]?.clientY ?? 0;
        touchStartScrollTopRef.current = scrollElement.scrollTop;
        isTouchingRef.current = true;
        expectedFollowScrollTopRef.current = null;
        cancelFollowFrame();
      };
      const handleTouchMove = (event: TouchEvent) => {
        const currentClientY = event.touches[0]?.clientY;
        if (
          currentClientY !== undefined &&
          currentClientY >
            touchStartClientYRef.current + SCROLL_DIRECTION_EPSILON_PX
        ) {
          pausedByTouchGestureRef.current = true;
          pauseFollowing();
        }
      };
      const handleTouchEnd = () => {
        const moved =
          Math.abs(scrollElement.scrollTop - touchStartScrollTopRef.current) >
          SCROLL_DIRECTION_EPSILON_PX;
        isTouchingRef.current = false;
        const distanceFromEnd = Math.max(
          scrollElement.scrollHeight -
            scrollElement.scrollTop -
            scrollElement.clientHeight,
          0,
        );
        if (pausedByTouchGestureRef.current && !isFollowingRef.current) {
          cancelFollowFrame();
        } else if (moved && distanceFromEnd > FOLLOW_RESUME_DISTANCE_PX) {
          pauseFollowing();
        } else if (
          distanceFromEnd <= FOLLOW_RESUME_DISTANCE_PX ||
          (!moved && wasFollowingBeforeTouchRef.current)
        ) {
          isFollowingRef.current = true;
          scheduleFollowToEnd();
        }
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.matches('input, textarea, [contenteditable="true"]')
        ) {
          return;
        }
        if (
          event.key === "ArrowUp" ||
          event.key === "PageUp" ||
          event.key === "Home" ||
          (event.key === " " && event.shiftKey)
        ) {
          pauseFollowing();
        }
      };
      const handleScroll = () => {
        const nextScrollTop = scrollElement.scrollTop;
        const movedUp =
          nextScrollTop <
          previousScrollTopRef.current - SCROLL_DIRECTION_EPSILON_PX;
        const expectedFollowScrollTop = expectedFollowScrollTopRef.current;
        const reachedExpectedFollowPosition =
          expectedFollowScrollTop !== null &&
          Math.abs(nextScrollTop - expectedFollowScrollTop) <=
            SCROLL_DIRECTION_EPSILON_PX;
        if (reachedExpectedFollowPosition) {
          expectedFollowScrollTopRef.current = null;
        }
        const distanceFromEnd = Math.max(
          scrollElement.scrollHeight -
            nextScrollTop -
            scrollElement.clientHeight,
          0,
        );
        const maximumScrollTop = Math.max(
          scrollElement.scrollHeight - scrollElement.clientHeight,
          0,
        );
        const clampedToEndAfterResize =
          movedUp &&
          isFollowingRef.current &&
          previousScrollTopRef.current >
            maximumScrollTop + SCROLL_DIRECTION_EPSILON_PX &&
          Math.abs(nextScrollTop - maximumScrollTop) <=
            SCROLL_DIRECTION_EPSILON_PX;

        if (
          movedUp &&
          !reachedExpectedFollowPosition &&
          !clampedToEndAfterResize
        ) {
          pauseFollowing();
        } else if (distanceFromEnd <= FOLLOW_RESUME_DISTANCE_PX) {
          isFollowingRef.current = true;
        }
        previousScrollTopRef.current = nextScrollTop;
      };

      scrollElement.addEventListener("wheel", handleWheel, { passive: true });
      scrollElement.addEventListener("touchstart", handleTouchStart, {
        passive: true,
      });
      scrollElement.addEventListener("touchmove", handleTouchMove, {
        passive: true,
      });
      scrollElement.addEventListener("touchend", handleTouchEnd, {
        passive: true,
      });
      scrollElement.addEventListener("touchcancel", handleTouchEnd, {
        passive: true,
      });
      scrollElement.addEventListener("keydown", handleKeyDown);
      scrollElement.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        scrollElement.removeEventListener("wheel", handleWheel);
        scrollElement.removeEventListener("touchstart", handleTouchStart);
        scrollElement.removeEventListener("touchmove", handleTouchMove);
        scrollElement.removeEventListener("touchend", handleTouchEnd);
        scrollElement.removeEventListener("touchcancel", handleTouchEnd);
        scrollElement.removeEventListener("keydown", handleKeyDown);
        scrollElement.removeEventListener("scroll", handleScroll);
      };
    }, [cancelFollowFrame, currentSession?.id, scheduleFollowToEnd, scrollRef]);

    React.useEffect(() => {
      scheduleFollowToEnd();
    }, [
      currentSession?.id,
      isGenerating,
      rows.length,
      scheduleFollowToEnd,
      totalSize,
    ]);

    React.useEffect(() => cancelFollowFrame, [cancelFollowFrame]);

    React.useEffect(() => {
      onPendingToolVisibilityChange?.(isPendingToolMessageVisible);
    }, [isPendingToolMessageVisible, onPendingToolVisibilityChange]);

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToMessage(messageId, behavior) {
          const index = messageRowIndex.get(messageId);
          if (index === undefined) return false;
          isFollowingRef.current = false;
          expectedFollowScrollTopRef.current = null;
          cancelFollowFrame();
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          virtualizer.scrollToIndex(index, {
            align: "center",
            behavior:
              behavior ?? (isGenerating || reduceMotion ? "auto" : "smooth"),
          });
          return true;
        },
        scrollToEnd(behavior = "auto") {
          isFollowingRef.current = true;
          cancelFollowFrame();
          const scrollElement = scrollRef.current;
          if (!scrollElement) return;
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          const targetScrollTop = Math.max(
            scrollElement.scrollHeight - scrollElement.clientHeight,
            0,
          );
          expectedFollowScrollTopRef.current = targetScrollTop;
          scrollElement.scrollTo({
            top: targetScrollTop,
            behavior:
              isGenerating || reduceMotion || behavior === "auto"
                ? "auto"
                : "smooth",
          });
        },
      }),
      [
        cancelFollowFrame,
        isGenerating,
        messageRowIndex,
        scrollRef,
        virtualizer,
      ],
    );

    return (
      <div
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: totalSize }}
        data-testid="virtualized-message-timeline"
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.kind === "assistant" ? (
                <AssistantHeader
                  instruction={currentSession?.systemInstruction || ""}
                  disabled={mutationsDisabled}
                  onUpdate={onUpdateInstruction}
                  onDelete={
                    currentSession?.systemInstruction
                      ? () => onUpdateInstruction("")
                      : undefined
                  }
                />
              ) : (
                <div
                  id={`message-${row.message.id}`}
                  data-message-id={row.message.id}
                  tabIndex={-1}
                  className={`rounded-xl outline-none transition-shadow ${
                    focusedMessageId === row.message.id
                      ? "ring-2 ring-blue-500/60 ring-offset-2 ring-offset-background"
                      : ""
                  }`}
                >
                  <MessageItem
                    message={row.message}
                    actionsDisabled={actionsDisabled}
                    mutationsDisabled={mutationsDisabled}
                    branchInfo={getMessageBranchInfo(
                      activeMessageTree,
                      row.message.id,
                    )}
                    availableModels={availableModels}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    canEditUserMessage={
                      row.message.role === "user" &&
                      row.messageIndex !== lastUserMessageIndex
                    }
                    onSubmitUserEdit={onSubmitUserEdit}
                    onRetract={
                      row.message.role === "user" &&
                      row.messageIndex === lastUserMessageIndex
                        ? () => onRetract(row.message)
                        : undefined
                    }
                    isLast={row.messageIndex === messages.length - 1}
                    isTyping={
                      isGenerating && row.messageIndex === messages.length - 1
                    }
                    onRegenerate={(model) =>
                      onRegenerate(row.message.id, model)
                    }
                    onContinue={() => onContinue(row.message.id)}
                    onReply={() => onReply(row.message)}
                    onNavigateToMessage={onNavigateToMessage}
                    onVersionChange={onVersionChange}
                    onToolConfirmationDecision={onToolConfirmationDecision}
                    onRevokeToolSessionApproval={onRevokeToolSessionApproval}
                  />
                  {row.message.role === "model" &&
                  row.messageIndex === messages.length - 1 &&
                  !isGenerating &&
                  row.message.suggestedQuestions?.length ? (
                    <FollowUpQuestions
                      questions={row.message.suggestedQuestions}
                      onClick={onSuggestionClick}
                      disabled={mutationsDisabled}
                    />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

VirtualizedMessageTimeline.displayName = "VirtualizedMessageTimeline";

export default VirtualizedMessageTimeline;
