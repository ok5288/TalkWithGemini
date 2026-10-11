import { describe, expect, it } from "vitest";
import {
  deriveExplorer,
  EXPLORER_TRAVEL_EXAMPLE,
  parseExplorerImport,
  remapExplorerImport,
} from "@/lib/intelligentUi/explorer";
const original = EXPLORER_TRAVEL_EXAMPLE.props.dataset;
if (original.kind !== "inline") throw Error("Fixture must be inline");
const columns = original.data.columns;
const imported = () =>
  parseExplorerImport(
    "Name,Travel,Nightly,Stars,Secret\nB,100,120,7,private",
    "csv",
  ).dataset!;
const mapping = { name: "c1", transport: "c2", hotel: "c3", rating: "c4" };
describe("explicit explorer import column mapping", () => {
  it("preserves target IDs and units for the linked travel calculations", () => {
    const result = remapExplorerImport(imported(), columns, mapping);
    expect(result.errors).toEqual([]);
    expect(result.dataset?.columns).toEqual(columns);
    expect(result.omittedColumns).toEqual(["c5"]);
    expect(result.dataset?.rows[0].values).toEqual({
      name: "B",
      transport: 100,
      hotel: 120,
      rating: 7,
    });
    const derived = deriveExplorer(
      EXPLORER_TRAVEL_EXAMPLE,
      { parameters: { nights: 3 }, selected: ["r1"] },
      result.dataset!,
    );
    expect(derived.selectedRows[0].values.total).toBe(460);
    expect(derived.selectedRows[0].values.perPerson).toBe(230);
    expect(result.dataset?.version).toBe(
      remapExplorerImport(imported(), columns, mapping).dataset?.version,
    );
  });
  it("rejects missing, duplicate, unknown and mismatched mappings", () => {
    for (const invalid of [
      {},
      { ...mapping, hotel: "c2" },
      { ...mapping, extra: "c5" },
      { ...mapping, transport: "c1" },
      { ...mapping, hotel: "missing" },
    ]) {
      expect(
        remapExplorerImport(imported(), columns, invalid).dataset,
      ).toBeNull();
    }
  });
  it("does not silently round currency or convert currencies", () => {
    const data = imported();
    data.rows[0].values.c2 = 1.001;
    expect(remapExplorerImport(data, columns, mapping).errors).toContainEqual({
      code: "invalid_currency",
      field: "transport",
      row: "r1",
    });
    data.rows[0].values.c2 = 1;
    data.columns[1].unit = { kind: "currency", code: "USD", precision: 2 };
    expect(remapExplorerImport(data, columns, mapping).errors).toContainEqual({
      code: "mapping_unit_mismatch",
      field: "transport",
    });
  });
  it("does not alias or mutate imported data and changes version for new values", () => {
    const data = imported(),
      first = remapExplorerImport(data, columns, mapping).dataset!;
    data.rows[0].values.c2 = 110;
    const second = remapExplorerImport(data, columns, mapping).dataset!;
    expect(first.rows[0].values.transport).toBe(100);
    expect(second.version).not.toBe(first.version);
    expect(first.rows[0].values).not.toHaveProperty("c5");
  });
});
