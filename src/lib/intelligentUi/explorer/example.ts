import type {
  ExplorerDefinitionV1,
  ExplorerDefinitionV2,
  ExplorerUnit,
} from "./types";
const money: ExplorerUnit = { kind: "currency", code: "CNY", precision: 2 };
export const EXPLORER_TRAVEL_EXAMPLE: ExplorerDefinitionV1 = {
  version: 1,
  kind: "explorer",
  title: "Travel costs",
  summary: "Example travel options, not live quotations.",
  props: {
    provenance: "example",
    dataset: {
      kind: "inline",
      data: {
        id: "travel",
        version: "example-1",
        columns: [
          { id: "name", label: "Option", type: "text" },
          { id: "transport", label: "Transport", type: "number", unit: money },
          { id: "hotel", label: "Per night", type: "number", unit: money },
          { id: "rating", label: "Rating", type: "number" },
        ],
        rows: [
          {
            id: "a",
            values: { name: "A", transport: 200, hotel: 150, rating: 8 },
          },
          {
            id: "b",
            values: { name: "B", transport: 100, hotel: 120, rating: 7 },
          },
          {
            id: "c",
            values: { name: "C", transport: 300, hotel: 200, rating: 9 },
          },
        ],
      },
    },
    parameters: [
      { id: "nights", label: "Nights", value: 2, min: 1, max: 30, step: 1 },
      { id: "people", label: "People", value: 2, min: 1, max: 20, step: 1 },
      { id: "budget", label: "Budget", value: 600, min: 0, unit: money },
    ],
    nodes: [
      {
        id: "lodging",
        label: "Lodging",
        stage: "row",
        operation: "multiply",
        inputs: [{ field: "hotel" }, { parameter: "nights" }],
        unit: money,
      },
      {
        id: "total",
        label: "Total",
        stage: "row",
        operation: "add",
        inputs: [{ field: "transport" }, { node: "lodging" }],
        unit: money,
      },
      {
        id: "perPerson",
        label: "Per person",
        stage: "row",
        operation: "divide",
        inputs: [{ node: "total" }, { parameter: "people" }],
        unit: money,
      },
      {
        id: "selectedTotal",
        label: "Selected total",
        stage: "aggregate",
        operation: "sum",
        collection: "selected",
        inputs: [{ node: "total" }],
        unit: money,
      },
    ],
    filters: [{ field: "total", operator: "lte", parameter: "budget" }],
    chart: { type: "bar", x: "name", y: "total" },
    metrics: ["selectedTotal"],
  },
};

const {
  chart: _chart,
  metrics: _metrics,
  ...travelProps
} = EXPLORER_TRAVEL_EXAMPLE.props;
void _chart;
void _metrics;
export const EXPLORER_TRAVEL_V2_EXAMPLE: ExplorerDefinitionV2 = {
  ...EXPLORER_TRAVEL_EXAMPLE,
  version: 2,
  props: {
    ...travelProps,
    sections: [
      { kind: "parameters" },
      { kind: "metrics", nodes: ["selectedTotal"] },
      {
        kind: "chart",
        id: "totalChart",
        title: "Total by option",
        type: "bar",
        x: "name",
        y: "total",
      },
      {
        kind: "chart",
        id: "personChart",
        title: "Cost per person",
        type: "bar",
        x: "name",
        y: "perPerson",
      },
      { kind: "table" },
      { kind: "notices" },
    ],
  },
};
