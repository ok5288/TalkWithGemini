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
import ExplorerUi from "@/components/content/intelligentUi/ExplorerUi";
import { getNativeInitialState } from "@/lib/intelligentUi/catalog";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import {
  EXPLORER_TRAVEL_EXAMPLE,
  type ExplorerDataset,
  type ExplorerDefinition,
} from "@/lib/intelligentUi/explorer";
import commonMessages from "@/i18n/locales/en/Common.json";
import messages from "@/i18n/locales/en/IntelligentUi.json";

vi.mock("next/dynamic", () => ({
  default: () =>
    function LazyChart({
      source,
      onDataPointClick,
    }: {
      source?: string;
      onDataPointClick?: (event: {
        componentType: string;
        seriesType: string;
        seriesIndex: number;
        dataIndex: number;
      }) => void;
    }) {
      return (
        <>
          <div data-testid="explorer-chart" data-source={source} />
          <button
            type="button"
            aria-label="Click explorer chart point"
            onClick={() =>
              onDataPointClick?.({
                componentType: "series",
                seriesType: "bar",
                seriesIndex: 0,
                dataIndex: 0,
              })
            }
          />
        </>
      );
    },
}));

afterEach(cleanup);

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

function mapImportedColumns(names: string[]) {
  for (const name of names) {
    fireEvent.click(
      screen.getByRole("combobox", {
        name: `Map source column to ${name}`,
      }),
    );
    const options = screen.getAllByRole("option", {
      name: new RegExp(`^${name} ·`),
    });
    fireEvent.click(options[options.length - 1]);
  }
}

function Harness({
  definition = EXPLORER_TRAVEL_EXAMPLE,
  dataset,
  onImportDataset,
  initial,
}: {
  definition?: ExplorerDefinition;
  dataset?: ExplorerDataset;
  onImportDataset?: (dataset: ExplorerDataset) => void;
  initial?: JsonObject;
}) {
  const [state, setState] = useState<JsonObject>(
    initial ?? getNativeInitialState(definition),
  );
  return (
    <ExplorerUi
      definition={definition}
      state={state}
      onChange={setState}
      dataset={dataset}
      onImportDataset={onImportDataset}
    />
  );
}

describe("explorer Intelligent UI", () => {
  it("links parameters, filtered rows, selection, metrics, and chart data", () => {
    render(wrap(<Harness />));
    expect(screen.getByText("2 rows")).toBeTruthy();
    expect(screen.getByText("Selected total")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select row a"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    const metric = screen.getByText("Selected total").parentElement;
    expect(metric?.textContent).toContain("500");
    expect(screen.getByTestId("explorer-chart")).toBeTruthy();
    const chartSource = JSON.parse(
      screen.getByTestId("explorer-chart").getAttribute("data-source") || "{}",
    );
    expect(chartSource.data.source).toEqual([
      ["A", 500],
      ["B", 340],
    ]);
  });

  it("shows invalid numeric parameters and performs all interactions locally", () => {
    const definition = EXPLORER_TRAVEL_EXAMPLE;
    render(
      wrap(
        <Harness
          definition={definition}
          initial={{
            ...getNativeInitialState(definition),
            parameters: { nights: 0, people: 2, budget: 600 },
          }}
        />,
      ),
    );
    expect(screen.getByLabelText("Nights").getAttribute("aria-invalid")).toBe(
      "true",
    );
    fireEvent.change(screen.getByLabelText("Search rows"), {
      target: { value: "missing" },
    });
    expect(screen.getByText("0 rows")).toBeTruthy();
  });

  it("keeps numeric range editing text and associates range errors", () => {
    const definition = EXPLORER_TRAVEL_EXAMPLE;
    render(
      wrap(
        <Harness
          definition={definition}
          initial={{
            ...getNativeInitialState(definition),
            ranges: { total: { min: "1e" } },
          }}
        />,
      ),
    );
    const minimum = screen.getByLabelText("Minimum for Total");
    expect((minimum as HTMLInputElement).value).toBe("1e");
    expect(minimum.getAttribute("aria-invalid")).toBe("true");
    const describedBy = minimum.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBeTruthy();
    fireEvent.change(minimum, { target: { value: "100" } });
    expect(minimum.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("2 rows")).toBeTruthy();
  });

  it("maps chart points by stable row id when labels are duplicated", () => {
    const definition = structuredClone(EXPLORER_TRAVEL_EXAMPLE);
    if (definition.props.dataset.kind !== "inline") throw new Error("fixture");
    definition.props.dataset.data.rows[0].values.name = "Same";
    definition.props.dataset.data.rows[1].values.name = "Same";
    render(wrap(<Harness definition={definition} />));
    fireEvent.click(
      screen.getByRole("button", { name: "Click explorer chart point" }),
    );
    expect(
      (screen.getByLabelText("Select row a") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Select row b") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("previews CSV and persists imported data only after explicit confirmation", () => {
    const onImportDataset = vi.fn();
    render(wrap(<Harness onImportDataset={onImportDataset} />));
    fireEvent.click(screen.getByRole("button", { name: "Import data" }));
    fireEvent.change(screen.getByLabelText("Paste data"), {
      target: { value: "Option,Transport,Per night,Rating\nLocal,42,120,8" },
    });
    expect(screen.getByText("Import preview")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(onImportDataset).not.toHaveBeenCalled();
    mapImportedColumns(["Option", "Transport", "Per night", "Rating"]);
    fireEvent.click(screen.getByRole("button", { name: "Use imported data" }));
    expect(onImportDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ id: "name" }),
          expect.objectContaining({ id: "transport" }),
        ]),
        rows: [expect.objectContaining({ id: "r1" })],
      }),
    );
    expect(onImportDataset.mock.calls[0][0].rows[0].values).toMatchObject({
      name: "Local",
      transport: 42,
      hotel: 120,
      rating: 8,
    });
  });

  it("does not confirm an import with invalid typed cells", () => {
    const onImportDataset = vi.fn();
    render(wrap(<Harness onImportDataset={onImportDataset} />));
    fireEvent.click(screen.getByRole("button", { name: "Import data" }));
    fireEvent.change(screen.getByLabelText("Paste data"), {
      target: {
        value: "Option,Transport,Per night,Rating\nLocal,not-a-number,120,8",
      },
    });
    mapImportedColumns(["Option", "Transport", "Per night", "Rating"]);
    expect(
      (
        screen.getByRole("button", {
          name: "Use imported data",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Mapped columns have incompatible types."),
    ).toBeTruthy();
    expect(onImportDataset).not.toHaveBeenCalled();
  });

  it("keeps projection provenance and excludes unselected private state", () => {
    const definition = EXPLORER_TRAVEL_EXAMPLE;
    const state = {
      ...getNativeInitialState(definition),
      selected: ["a"],
      search: "A",
    };
    const block = {
      id: "explorer",
      type: "intelligent_ui" as const,
      schemaVersion: 1 as const,
      renderer: "native" as const,
      definition,
      definitionRevision: 1,
      status: "ready" as const,
      fallbackMarkdown: definition.summary,
      state,
      stateRevision: 1,
      staticSnapshot: "",
      sourceRefs: ["source-1"],
    } satisfies IntelligentUiBlock;
    const original = projectUiBlock(block, { purpose: "static-original" });
    const current = projectUiBlock(block, { purpose: "static-current" });
    expect(original).toContain("Illustrative example data");
    expect(original).toContain("Option");
    expect(original).toContain("B");
    expect(current).toContain("Illustrative example data");
    expect(current).toContain("A");
    expect(current).not.toContain("| B |");
    expect(current).toContain("source-1");
  });

  it("uses an explicit imported snapshot only for current output", () => {
    const definition = EXPLORER_TRAVEL_EXAMPLE;
    const originalDataset =
      definition.props.dataset.kind === "inline"
        ? definition.props.dataset.data
        : null;
    if (!originalDataset) throw new Error("Explorer fixture must be inline");
    const imported: ExplorerDataset = {
      id: "import",
      version: "local-1",
      columns: originalDataset.columns,
      rows: [
        {
          id: "local",
          values: {
            name: "Private local row",
            transport: 1,
            hotel: 1,
            rating: 1,
          },
        },
      ],
    };
    const block = {
      id: "explorer-import",
      type: "intelligent_ui" as const,
      schemaVersion: 1 as const,
      renderer: "native" as const,
      definition,
      definitionRevision: 1,
      status: "ready" as const,
      fallbackMarkdown: definition.summary,
      state: { ...getNativeInitialState(definition), selected: ["local"] },
      stateRevision: 1,
      staticSnapshot: "",
      sourceRefs: [],
      dataSnapshot: imported,
    } as IntelligentUiBlock & { dataSnapshot: ExplorerDataset };
    const original = projectUiBlock(block, { purpose: "static-original" });
    const current = projectUiBlock(block, { purpose: "static-current" });
    expect(original).toContain("A");
    expect(original).not.toContain("Private local row");
    expect(current).toContain("Data supplied by you");
    expect(current).toContain("Private local row");
  });

  it("supports selecting all visible rows without changing hidden data", () => {
    render(wrap(<Harness />));
    const table = screen.getByRole("table");
    fireEvent.click(screen.getByLabelText("Select visible rows"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(
      within(table)
        .getAllByRole("checkbox")
        .filter((input) => (input as HTMLInputElement).checked),
    ).toHaveLength(3);
  });
});
