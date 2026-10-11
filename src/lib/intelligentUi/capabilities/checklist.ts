import { z } from "zod";
import type { ChecklistDefinition, JsonObject } from "../types";
import { base, id, items, knownStrings, text } from "./shared";
export const checklistSchema = z.object({
  ...base,
  kind: z.literal("checklist"),
  props: z.object({
    items: items(
      z.object({ id, label: text, checked: z.boolean().optional() }),
    ),
  }),
});
export interface ChecklistState extends JsonObject {
  checked: string[];
}
export function initialChecklist(
  definition: ChecklistDefinition,
): ChecklistState {
  return {
    checked: definition.props.items
      .filter((item) => item.checked)
      .map((item) => item.id),
  };
}
export function normalizeChecklist(
  definition: ChecklistDefinition,
  state: JsonObject,
): ChecklistState {
  return {
    checked:
      state.checked === undefined
        ? initialChecklist(definition).checked
        : knownStrings(
            state.checked,
            definition.props.items.map((item) => item.id),
          ),
  };
}
export const checklistCapability = {
  schema: checklistSchema,
  initial: initialChecklist,
  normalize: normalizeChecklist,
  prompt: "checklist: props {items:[{id,label,checked?}]}.",
};
