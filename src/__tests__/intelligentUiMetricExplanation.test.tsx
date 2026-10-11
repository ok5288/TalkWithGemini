// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExplorerUi from "@/components/content/intelligentUi/ExplorerUi";
import {
  deriveExplorer,
  EXPLORER_TRAVEL_EXAMPLE,
  initialExplorer,
  type ExplorerDefinition,
} from "@/lib/intelligentUi/explorer";
import {
  formatExplorerMetricExplanation,
  renderUiMarkdown,
} from "@/lib/intelligentUi/presentation";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
import messages from "@/i18n/locales/en/IntelligentUi.json";
import commonMessages from "@/i18n/locales/en/Common.json";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
afterEach(cleanup);

function definition(
  values: (number | null)[] = [0, null, 8],
): ExplorerDefinition {
  return {
    version: 1,
    kind: "explorer",
    title: "Statistics",
    summary: "Provided data",
    props: {
      provenance: "user",
      dataset: {
        kind: "inline",
        data: {
          id: "data",
          version: "1",
          columns: [{ id: "value", label: "Amount", type: "number" }],
          rows: values.map((value, index) => ({
            id: String(index),
            values: { value },
          })),
        },
      },
      parameters: [],
      nodes: [
        {
          id: "sum",
          label: "Sum",
          stage: "aggregate",
          operation: "sum",
          collection: "filtered",
          inputs: [{ field: "value" }],
        },
        {
          id: "selectedSum",
          label: "Selected sum",
          stage: "aggregate",
          operation: "sum",
          collection: "selected",
          inputs: [{ field: "value" }],
        },
        {
          id: "half",
          label: "Half",
          stage: "scalar",
          operation: "divide",
          inputs: [{ node: "sum" }, { constant: 2 }],
        },
      ],
    },
  };
}

describe("shared Explorer metric explanations", () => {
  it("distinguishes no selection, all-missing inputs and a valid zero", () => {
    const result = deriveExplorer(definition([0, null]), {});
    expect(result.metrics.sum).toBe(0);
    expect(result.metricExplanations.sum).toMatchObject({
      included: 1,
      missing: 1,
      empty: false,
      status: "value",
      collection: "filtered",
    });
    expect(result.metricExplanations.selectedSum.status).toBe("no-selection");
    const missing = deriveExplorer(definition([null, null]), {});
    expect(missing.metricExplanations.sum.status).toBe("all-missing");
    expect(missing.metricExplanations.half.status).toBe("missing-inputs");
  });

  it("explains scalar formulas and null propagation without invented row counts", () => {
    const result = deriveExplorer(definition(), {});
    expect(result.metricExplanations.half).toMatchObject({
      formula: "divide(Sum, 2)",
      empty: false,
      status: "value",
    });
    expect(result.metricExplanations.half.included).toBeUndefined();
    const text = formatExplorerMetricExplanation(
      result.metricExplanations.half,
      "en",
    );
    expect(text).toContain("Formula: divide(Sum, 2)");
    expect(text).toContain("Missing inputs produce no result");
    expect(text).not.toContain("Participating:");
  });

  it("uses identical explanation text in React and static output", () => {
    const d = definition();
    const state = initialExplorer(d);
    const result = deriveExplorer(d, state);
    const explanation = formatExplorerMetricExplanation(
      result.metricExplanations.sum,
      "en",
    );
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ IntelligentUi: messages, Common: commonMessages }}
      >
        <ExplorerUi definition={d} state={state} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(explanation)).toBeTruthy();
    const block: IntelligentUiBlock = {
      id: "ui",
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: d,
      definitionRevision: 1,
      status: "ready",
      state,
      stateRevision: 0,
      staticSnapshot: "",
      fallbackMarkdown: d.summary,
      sourceRefs: [],
    };
    const markdown = renderUiMarkdown(block, true, "en");
    const plain = markdown.replace(/\\([\\`*_{}\[\]<>()#!|])/g, "$1");
    expect(plain).toContain(explanation);
  });

  it.each(["en", "zh", "ja"])(
    "describes existing signed currency rounding in %s",
    (locale) => {
      const d = structuredClone(EXPLORER_TRAVEL_EXAMPLE);
      const result = deriveExplorer(d, { selected: ["a"] });
      const text = formatExplorerMetricExplanation(
        result.metricExplanations.selectedTotal,
        locale,
      );
      expect(text).toContain("Math.round");
      expect(text).toContain("Number.EPSILON");
      expect(text).not.toMatch(/half.up|empty:|true|false|\{precision\}/i);
    },
  );

  it.each(["en", "zh", "ja"])(
    "explains noncurrency split rounding in %s",
    (locale) => {
      const d = definition();
      d.props.nodes = [
        {
          id: "parts",
          label: "Parts",
          stage: "scalar",
          operation: "split",
          inputs: [{ constant: 1.5 }, { constant: 2 }],
        },
      ];
      const result = deriveExplorer(d, {});
      expect(result.metrics.parts).toEqual([1, 1]);
      const explanation = formatExplorerMetricExplanation(
        result.metricExplanations.parts,
        locale,
      );
      expect(explanation).toContain("Math.round");
      expect(explanation).not.toContain("Number.EPSILON");
      expect(result.metricExplanations.parts.rounding?.split).toBe(true);
      const block: IntelligentUiBlock = {
        id: "split",
        type: "intelligent_ui",
        renderer: "native",
        schemaVersion: 1,
        definition: d,
        definitionRevision: 1,
        stateRevision: 1,
        state: {},
        status: "ready",
        staticSnapshot: "",
        fallbackMarkdown: "",
        sourceRefs: [],
      };
      expect(
        renderUiMarkdown(block, true, locale).replace(
          /\\([\\`*_{}\[\]<>()#!|])/g,
          "$1",
        ),
      ).toContain(explanation);
      if (locale === "en") {
        render(
          <NextIntlClientProvider
            locale="en"
            messages={{ IntelligentUi: messages, Common: commonMessages }}
          >
            <ExplorerUi definition={d} state={{}} onChange={vi.fn()} />
          </NextIntlClientProvider>,
        );
        expect(screen.getByText(explanation)).toBeTruthy();
      }
    },
  );

  it("keeps Explorer signed midpoint rounding distinct from calculator half-up", () => {
    const d = definition([-101]);
    const money = { kind: "currency" as const, code: "CNY", precision: 0 };
    if (d.props.dataset.kind !== "inline") throw new Error("fixture");
    d.props.dataset.data.columns[0].unit = money;
    d.props.parameters = [{ id: "people", label: "People", value: 2 }];
    d.props.nodes = [
      {
        id: "perPerson",
        label: "Per person",
        stage: "row",
        operation: "divide",
        inputs: [{ field: "value" }, { parameter: "people" }],
        unit: money,
      },
      {
        id: "sum",
        label: "Sum",
        stage: "aggregate",
        operation: "sum",
        collection: "filtered",
        inputs: [{ node: "perPerson" }],
        unit: money,
      },
    ];
    const result = deriveExplorer(d, {});
    expect(result.rows[0].values.perPerson).toBe(-50);
    expect(result.metrics.sum).toBe(-50);
    expect(
      formatExplorerMetricExplanation(result.metricExplanations.sum),
    ).toContain("positive infinity");
  });
});
