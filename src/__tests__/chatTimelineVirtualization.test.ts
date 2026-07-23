import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("chat timeline virtualization", () => {
  it("uses stable dynamic rows with explicit scroll following", () => {
    const source = readProjectFile(
      "src/components/chat/VirtualizedMessageTimeline.tsx",
    );

    expect(source).toContain("useVirtualizer<HTMLDivElement, HTMLDivElement>");
    expect(source).toContain("getItemKey:");
    expect(source).toContain("ref={virtualizer.measureElement}");
    expect(source).toContain("overscan: 8");
    expect(source).toContain('anchorTo: "start"');
    expect(source).toContain("followOnAppend: false");
    expect(source).toContain("shouldAdjustScrollPositionOnItemSizeChange");
    expect(source).toContain("FOLLOW_RESUME_DISTANCE_PX = 8");
    expect(source).toContain("scrollElement.scrollTo({");
    expect(source).not.toContain("virtualizer.scrollToEnd");
    expect(source).toContain("useFlushSync: false");
  });

  it("routes search, reply, branch, and pending-tool focus through the timeline", () => {
    const shell = readProjectFile("src/components/app/ChatAppShell.tsx");

    expect(shell).toContain("scrollToMessage(focusedMessageId)");
    expect(shell).toContain("onNavigateToMessage={focusMessage}");
    expect(shell).toContain("onPendingToolVisibilityChange");
    expect(shell).toContain("handleTimelineVersionChange");
    expect(shell).toContain("[focusedMessageId, messages.length, viewMode]");
  });

  it("defers expensive markdown work until it is near the chat viewport", () => {
    const markdown = readProjectFile(
      "src/components/content/MarkdownRendererClient.tsx",
    );
    const diagrams = readProjectFile(
      "src/components/content/markdown/DiagramBlock.tsx",
    );

    expect(markdown).toContain('rootMargin: "600px 0px"');
    expect(markdown).toContain("shouldUseHeavyMarkdown");
    expect(diagrams).toContain('rootMargin: "600px 0px"');
  });

  it("keeps streaming scroll corrections immediate and reasoning lightweight", () => {
    const shell = readProjectFile("src/components/app/ChatAppShell.tsx");
    const reasoning = readProjectFile(
      "src/components/content/ReasoningBlock.tsx",
    );

    expect(shell).not.toContain("motion-safe:scroll-smooth");
    expect(reasoning).toContain("isStreaming={isThinking}");
  });
});
