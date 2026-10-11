// @vitest-environment jsdom
import React, { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeUi from "@/components/content/intelligentUi/NativeUi";
import IntelligentUiCard from "@/components/content/intelligentUi/IntelligentUiCard";
import { getNativeInitialState } from "@/lib/intelligentUi/catalog";
import type {
  IntelligentUiBlock,
  NativeDefinition,
  JsonObject,
} from "@/lib/intelligentUi/types";
import commonMessages from "@/i18n/locales/en/Common.json";
import messages from "@/i18n/locales/en/IntelligentUi.json";

vi.mock("next/dynamic", () => ({
  default: () =>
    function LazyMock({ source }: { source?: string }) {
      return <div data-testid="lazy-renderer" data-source={source} />;
    },
}));
afterEach(cleanup);
const checklist: NativeDefinition = {
  version: 1,
  kind: "checklist",
  title: "Trip",
  summary: "Packing",
  props: {
    items: [
      { id: "a", label: "Passport" },
      { id: "b", label: "Tickets", checked: true },
    ],
  },
};
function wrap(children: React.ReactNode) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ IntelligentUi: messages, Common: commonMessages }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
function Harness({
  definition,
  initial,
}: {
  definition: NativeDefinition;
  initial?: JsonObject;
}) {
  const [state, setState] = useState(
    initial ?? getNativeInitialState(definition),
  );
  return <NativeUi definition={definition} state={state} onChange={setState} />;
}
function block(definition: NativeDefinition): IntelligentUiBlock {
  return {
    id: "b",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "native",
    definition,
    definitionRevision: 1,
    status: "ready",
    fallbackMarkdown: definition.summary,
    state: getNativeInitialState(definition),
    stateRevision: 0,
    staticSnapshot: "",
    sourceRefs: [],
  };
}

describe("native Intelligent UI", () => {
  it("keeps checklist state controlled and updates completion", () => {
    render(wrap(<Harness definition={checklist} />));
    expect(screen.getByText("1 of 2 completed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Passport"));
    expect(screen.getByText("2 of 2 completed")).toBeTruthy();
  });
  it("filters, sorts numerically, and preserves selected comparison rows", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "comparison",
      title: "Compare",
      summary: "Options",
      props: {
        columns: [{ key: "cost", label: "Cost" }],
        items: [
          { id: "a", label: "Expensive", values: { cost: 100 } },
          { id: "b", label: "Cheap", values: { cost: 20 } },
        ],
        provenance: "example",
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByLabelText("Select Expensive"));
    fireEvent.click(screen.getByRole("combobox", { name: "Sort by" }));
    fireEvent.click(screen.getByRole("option", { name: "Cost" }));
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Cheap"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "Cheap" },
    });
    expect(screen.queryByLabelText("Select Expensive")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "" },
    });
    expect(
      (screen.getByLabelText("Select Expensive") as HTMLInputElement).checked,
    ).toBe(true);
  });
  it("filters comparison values by a budget ceiling and lower bound while preserving selections", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "comparison",
      title: "Budget",
      summary: "Plans",
      props: {
        columns: [{ key: "cost", label: "Cost" }],
        items: [
          { id: "a", label: "Large", values: { cost: 100 } },
          { id: "b", label: "Medium", values: { cost: 50 } },
          { id: "c", label: "Small", values: { cost: 20 } },
          { id: "d", label: "Unknown", values: { cost: "unknown" } },
        ],
        provenance: "user",
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByLabelText("Select Large"));
    fireEvent.click(screen.getByRole("combobox", { name: "Numeric filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Cost" }));
    fireEvent.change(screen.getByLabelText("Maximum"), {
      target: { value: "50" },
    });
    expect(screen.queryByLabelText("Select Large")).toBeNull();
    expect(screen.queryByLabelText("Select Unknown")).toBeNull();
    expect(screen.getByLabelText("Select Medium")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Minimum"), {
      target: { value: "50" },
    });
    expect(screen.queryByLabelText("Select Small")).toBeNull();
    expect(screen.getByLabelText("Select Medium")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Maximum"), {
      target: { value: "" },
    });
    expect(
      (screen.getByLabelText("Select Large") as HTMLInputElement).checked,
    ).toBe(true);
  });
  it("exposes required and bounded form fields through native validation", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "form",
      title: "Goal",
      summary: "Plan",
      props: {
        fields: [
          { id: "name", label: "Goal", type: "text", required: true },
          {
            id: "hours",
            label: "Hours",
            type: "number",
            min: 1,
            max: 10,
            required: true,
          },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    const name = screen.getByLabelText("Goal *") as HTMLInputElement;
    expect(name.checkValidity()).toBe(false);
    fireEvent.change(name, { target: { value: "Study" } });
    const hours = screen.getByLabelText("Hours *") as HTMLInputElement;
    fireEvent.change(hours, { target: { value: "12" } });
    expect(hours.checkValidity()).toBe(false);
    fireEvent.change(hours, { target: { value: "3" } });
    expect(hours.checkValidity()).toBe(true);
  });
  it("uses shared single selection and checkbox multi-selection with required validation", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "form",
      title: "Preferences",
      summary: "Choose",
      props: {
        fields: [
          {
            id: "single",
            label: "Track",
            type: "select",
            required: true,
            options: [
              { value: "a", label: "Math" },
              { value: "b", label: "Science" },
            ],
          },
          {
            id: "multi",
            label: "Topics",
            type: "multiselect",
            required: true,
            options: [
              { value: "one", label: "Algebra" },
              { value: "two", label: "Geometry" },
            ],
          },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }));
    expect(
      screen
        .getByRole("combobox", { name: "Track" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Track" }), {
      key: "End",
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Track" }), {
      key: "Enter",
    });
    expect(
      screen.getByRole("combobox", { name: "Track" }).textContent,
    ).toContain("Science");
    fireEvent.click(screen.getByLabelText("Algebra"));
    fireEvent.click(screen.getByLabelText("Geometry"));
    expect((screen.getByLabelText("Algebra") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Geometry") as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Inputs are valid",
    );
  });
  it("grades multiple answers once and restores persisted quiz completion", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "quiz",
      title: "Quiz",
      summary: "Try",
      props: {
        questions: [
          {
            id: "q",
            prompt: "Choose two",
            multiple: true,
            options: [
              { id: "a", label: "One" },
              { id: "b", label: "Two" },
              { id: "c", label: "Three" },
            ],
            answerIds: ["a", "b"],
            explanation: "Both are correct",
          },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByLabelText("One"));
    fireEvent.click(screen.getByLabelText("Two"));
    fireEvent.click(screen.getByRole("button", { name: "Check answers" }));
    expect(screen.getByText("Score: 1 / 1")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Check answers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Three") as HTMLInputElement).closest("fieldset")
        ?.disabled,
    ).toBe(true);
  });
  it("splits amounts exactly and shows invalid input rather than coercing empty numbers", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "calculator",
      title: "Split",
      summary: "Share",
      props: {
        operation: "split",
        inputs: [
          { id: "total", label: "Amount", value: 100 },
          { id: "count", label: "People", value: 3 },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    expect(screen.getByText(/33.34.*33.33.*33.33/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("People"), {
      target: { value: "" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("switches chart metrics and filters the plotted dataset and table together", () => {
    const source = JSON.stringify({
      version: 1,
      renderer: "echarts",
      data: {
        kind: "inline",
        dimensions: ["name", "value"],
        source: [
          { name: "Alpha", value: 10 },
          { name: "Beta", value: 20 },
        ],
      },
      spec: {
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        series: [{ type: "bar" }],
      },
    });
    const definition: NativeDefinition = {
      version: 1,
      kind: "chart",
      title: "Chart",
      summary: "Values",
      props: {
        provenance: "example",
        charts: [
          { id: "one", label: "First", source },
          { id: "two", label: "Second", source },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "Second" }));
    expect(
      screen.getByRole("combobox", { name: "Metric" }).textContent,
    ).toContain("Second");
    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "Beta" },
    });
    const filtered = JSON.parse(
      screen.getByTestId("lazy-renderer").getAttribute("data-source") || "{}",
    );
    expect(filtered.data.source).toEqual([{ name: "Beta", value: 20 }]);
    fireEvent.click(screen.getByText("Show data table"));
    expect(screen.getByRole("cell", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: "Alpha" })).toBeNull();
  });
  it("shows and filters chart array rows through a stable object-row projection", () => {
    const source = JSON.stringify({
      version: 1,
      renderer: "echarts",
      data: {
        kind: "inline",
        dimensions: ["name", "value"],
        source: [
          ["Alpha", 10],
          ["Beta", 20],
        ],
      },
      spec: {
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        series: [{ type: "bar" }],
      },
    });
    const definition: NativeDefinition = {
      version: 1,
      kind: "chart",
      title: "Arrays",
      summary: "Values",
      props: {
        provenance: "user",
        charts: [{ id: "one", label: "Values", source }],
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByText("Show data table"));
    expect(screen.getByRole("columnheader", { name: "name" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "Beta" },
    });
    expect(screen.queryByRole("cell", { name: "Alpha" })).toBeNull();
    expect(screen.getByRole("cell", { name: "20" })).toBeTruthy();
    const filtered = JSON.parse(
      screen.getByTestId("lazy-renderer").getAttribute("data-source") || "{}",
    );
    expect(filtered.data.source).toEqual([{ name: "Beta", value: 20 }]);
    expect(JSON.parse(source).data.source).toEqual([
      ["Alpha", 10],
      ["Beta", 20],
    ]);
    expect(filtered.data.dimensions).toEqual(["name", "value"]);
  });
  it("keeps charts with series data static instead of filtering only the table", () => {
    const source = JSON.stringify({
      version: 1,
      renderer: "echarts",
      data: {
        kind: "inline",
        dimensions: ["name", "value"],
        source: [
          { name: "Alpha", value: 10 },
          { name: "Beta", value: 20 },
        ],
      },
      spec: {
        series: [{ type: "bar", data: [10, 20] }],
      },
    });
    const definition: NativeDefinition = {
      version: 1,
      kind: "chart",
      title: "Static chart",
      summary: "Legacy values",
      props: {
        provenance: "source",
        charts: [{ id: "one", label: "Values", source }],
      },
    };
    render(wrap(<Harness definition={definition} />));
    expect(screen.getByRole("status").textContent).toContain("Read-only");
    expect(screen.queryByLabelText("Filter")).toBeNull();
    expect(screen.queryByTestId("lazy-renderer")).toBeNull();
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByText(source)).toBeNull();
  });
  it("keeps form validation local without a host interaction footer", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "form",
      title: "Required",
      summary: "Details",
      props: {
        fields: [{ id: "name", label: "Name", type: "text", required: true }],
      },
    };
    render(
      wrap(
        <IntelligentUiCard
          block={block(definition)}
          enabled
          onStateChange={vi.fn()}
        />,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Bring into conversation" }),
    ).toBeNull();
    expect(screen.getByLabelText(/Name/)).toBeTruthy();
  });
  it("restores controlled state across new definition objects without resetting inputs", () => {
    const onChange = vi.fn();
    const view = render(
      wrap(
        <NativeUi
          definition={checklist}
          state={{ checked: ["a", "b"] }}
          onChange={onChange}
        />,
      ),
    );
    view.rerender(
      wrap(
        <NativeUi
          definition={structuredClone(checklist)}
          state={{ checked: ["a", "b"] }}
          onChange={onChange}
        />,
      ),
    );
    expect(
      (screen.getByLabelText("Passport") as HTMLInputElement).checked,
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("renders disabled history as static content and restores only content controls", () => {
    const onSendMessage = vi.fn();
    const onStateChange = vi.fn();
    const data = block(checklist);
    const view = render(
      wrap(
        <IntelligentUiCard
          block={data}
          enabled={false}
          onStateChange={onStateChange}
          onSendMessage={onSendMessage}
        />,
      ),
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Bring into conversation" }),
    ).toBeNull();
    view.rerender(
      wrap(
        <IntelligentUiCard
          block={data}
          enabled
          onStateChange={onStateChange}
          onSendMessage={onSendMessage}
        />,
      ),
    );
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Bring into conversation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Trip" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Passport" }));
    expect(onStateChange).toHaveBeenCalledWith(
      { checked: ["b", "a"] },
      undefined,
    );
    expect(onSendMessage).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: true, readOnly: true },
    { enabled: false, readOnly: false },
  ])(
    "does not mount an HTML runtime for static settings %o",
    ({ enabled, readOnly }) => {
      const data: IntelligentUiBlock = {
        ...block(checklist),
        renderer: "html",
        definition: {
          version: 1,
          title: "Simulation",
          summary: "Static explanation",
          html: "<script>throw Error()</script>",
        },
      };
      render(
        wrap(
          <IntelligentUiCard
            block={data}
            enabled={enabled}
            readOnly={readOnly}
            onStateChange={vi.fn()}
          />,
        ),
      );
      expect(screen.queryByTestId("lazy-renderer")).toBeNull();
      expect(screen.getByText(/Static explanation/)).toBeTruthy();
    },
  );
});

describe("native learning adapters", () => {
  it("requires revealing a flashcard, persists a self-rating and hides answers after navigation", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "flashcards",
      title: "Cards",
      summary: "Practice",
      props: {
        cards: [
          { id: "a", front: "First prompt", back: "First answer" },
          { id: "b", front: "Second prompt", back: "Second answer" },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    expect(
      (screen.getByRole("button", { name: "Mastered" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText("First answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("First answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mastered" }));
    expect(screen.getByText("Mastered: 1 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByText("Second answer")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Mastered" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Review unmastered cards"));
    expect(screen.getByText("Card 1 / 1")).toBeTruthy();
  });
  it("retries only incorrect questions and hides explanations until the next submission", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "quiz",
      title: "Quiz",
      summary: "Practice",
      props: {
        questions: [
          {
            id: "one",
            prompt: "First",
            options: [
              { id: "a", label: "First correct" },
              { id: "b", label: "First wrong" },
            ],
            answerIds: ["a"],
            explanation: "First explanation",
          },
          {
            id: "two",
            prompt: "Second",
            options: [
              { id: "a", label: "Second correct" },
              { id: "b", label: "Second wrong" },
            ],
            answerIds: ["a"],
            explanation: "Second explanation",
          },
        ],
      },
    };
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(screen.getByLabelText("First correct"));
    fireEvent.click(screen.getByLabelText("Second wrong"));
    fireEvent.click(screen.getByRole("button", { name: "Check answers" }));
    expect(screen.getByText("Second explanation")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry incorrect answers" }),
    );
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.queryByText("Second explanation")).toBeNull();
    fireEvent.click(screen.getByLabelText("Second correct"));
    fireEvent.click(screen.getByRole("button", { name: "Check answers" }));
    expect(screen.getByText("Latest overall score: 2 / 2")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Retry incorrect answers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("reports restored invalid choices on their field rather than accepting the form", () => {
    const definition: NativeDefinition = {
      version: 1,
      kind: "form",
      title: "Form",
      summary: "Choose",
      props: {
        fields: [
          {
            id: "f",
            label: "Track",
            type: "select",
            options: [{ value: "a", label: "Math" }],
          },
        ],
      },
    };
    render(
      wrap(
        <Harness
          definition={definition}
          initial={{ values: { f: "outside" } }}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }));
    expect(screen.getByRole("alert").textContent).toBe("Choose a valid value");
    expect(
      screen
        .getByRole("combobox", { name: "Track" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });
});
