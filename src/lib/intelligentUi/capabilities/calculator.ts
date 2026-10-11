import { z } from "zod";
import { isWithinNumericBounds } from "./numeric";
import type { CalculatorDefinition, JsonObject } from "../types";
import { calculateUi, validCalculationArity } from "../calculations";
import {
  base,
  bounds,
  finite,
  id,
  items,
  record,
  text,
  validBounds,
} from "./shared";
export const calculatorSchema = z.object({
  ...base,
  kind: z.literal("calculator"),
  props: z
    .object({
      operation: z.enum([
        "add",
        "subtract",
        "multiply",
        "divide",
        "scale",
        "split",
        "weighted",
      ]),
      inputs: items(
        z
          .object({ id, label: text, value: finite, ...bounds })
          .refine(
            (input) =>
              validBounds(input) && isWithinNumericBounds(input.value, input),
          ),
      ),
      precision: z.number().int().min(0).max(6).optional(),
    })
    .refine((props) =>
      validCalculationArity(props.operation, props.inputs.length),
    ),
});
export interface CalculatorState extends JsonObject {
  values: JsonObject;
}
export function initialCalculator(
  definition: CalculatorDefinition,
): CalculatorState {
  return {
    values: Object.fromEntries(
      definition.props.inputs.map((input) => [input.id, input.value]),
    ),
  };
}
export function normalizeCalculator(
  definition: CalculatorDefinition,
  state: JsonObject,
): CalculatorState {
  const values = record(state.values);
  return {
    values: Object.fromEntries(
      definition.props.inputs.map((input) => [
        input.id,
        Object.hasOwn(values, input.id) ? values[input.id] : input.value,
      ]),
    ),
  };
}
export const calculatorCapability = {
  schema: calculatorSchema,
  initial: initialCalculator,
  normalize: normalizeCalculator,
  derive: calculateUi,
  prompt:
    'calculator: props {operation:"add"|"subtract"|"multiply"|"divide"|"scale"|"split"|"weighted",inputs:[{id,label,value,min?,max?,step?}],precision?}; arithmetic requires at least two inputs; scale requires exactly amount,originalQuantity,targetQuantity; split exactly amount,people (precision defaults to 2); weighted alternating score,weight pairs. Never supply executable formulas.',
};
