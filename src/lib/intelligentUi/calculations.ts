import type { CalculatorDefinition, JsonObject } from "./types";
import { isWithinNumericBounds } from "./capabilities/numeric";
export type UiCalculationError =
  | "arity"
  | "finite"
  | "unsafeNumber"
  | "range"
  | "divisionByZero"
  | "originalZero"
  | "splitInputs"
  | "amountRange"
  | "negativeWeight"
  | "zeroWeight"
  | "resultFinite";
export function validCalculationArity(
  operation: CalculatorDefinition["props"]["operation"],
  count: number,
): boolean {
  if (operation === "scale") return count === 3;
  if (operation === "split") return count === 2;
  if (operation === "weighted") return count >= 2 && count % 2 === 0;
  return count >= 2;
}
export interface UiCalculation {
  value?: number;
  values?: number[];
  error?: UiCalculationError;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function isSafeCalculationNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_SAFE &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  );
}

function safeStep(value: number): number {
  if (!isSafeCalculationNumber(value)) throw new Error("unsafeNumber");
  return value;
}

/**
 * Convert a finite number's canonical decimal representation to minor units.
 * The conversion deliberately uses the decimal spelling of the input rather
 * than multiplying a binary float, so values such as 1.005 round correctly.
 * BigInt is kept inside this bounded helper; the public calculation result is
 * still JSON-compatible numbers.
 */
function toMinorUnits(value: number, precision: number): bigint | null {
  if (
    !isSafeCalculationNumber(value) ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 6
  )
    return null;
  const text = String(value);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const [, sign, integer, fraction = "", exponentText] = match;
  const exponent = exponentText ? Number(exponentText) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const digits = `${integer}${fraction}`;
  let units = BigInt(digits || "0");
  const decimalPlaces = fraction.length - exponent;
  const targetPlaces = precision;
  if (decimalPlaces <= targetPlaces) {
    units *= BigInt(10) ** BigInt(targetPlaces - decimalPlaces);
  } else {
    const divisor = BigInt(10) ** BigInt(decimalPlaces - targetPlaces);
    const remainder = units % divisor;
    units /= divisor;
    if (remainder * BigInt(2) >= divisor) units += BigInt(1);
  }
  if (sign === "-") units = -units;
  const limit = BigInt(MAX_SAFE);
  return units < -limit || units > limit ? null : units;
}

function fromMinorUnits(value: bigint, precision: number): number {
  const result = Number(value) / 10 ** precision;
  if (!isSafeCalculationNumber(result)) throw new Error("unsafeNumber");
  return result;
}

export function calculateUi(
  definition: CalculatorDefinition,
  state: JsonObject,
): UiCalculation {
  if (
    !validCalculationArity(
      definition.props.operation,
      definition.props.inputs.length,
    )
  )
    return { error: "arity" };
  const stored =
    state.values &&
    typeof state.values === "object" &&
    !Array.isArray(state.values)
      ? state.values
      : {};
  const values = definition.props.inputs.map((input) =>
    Object.hasOwn(stored, input.id) ? stored[input.id] : input.value,
  );
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v)))
    return { error: "finite" };
  if (values.some((v) => !isSafeCalculationNumber(v)))
    return { error: "unsafeNumber" };
  const n = values as number[];
  if (
    definition.props.inputs.some(
      (input, i) => !isWithinNumericBounds(n[i]!, input),
    )
  )
    return { error: "range" };
  const [a, b, c] = n as [number, number, number];
  let value: number;
  try {
    switch (definition.props.operation) {
      case "add":
        value = n.reduce((x, y) => safeStep(safeStep(x) + safeStep(y)), 0);
        break;
      case "subtract":
        value = n
          .slice(1)
          .reduce((x, y) => safeStep(safeStep(x) - safeStep(y)), a);
        break;
      case "multiply":
        value = n.reduce((x, y) => safeStep(safeStep(x) * safeStep(y)), 1);
        break;
      case "divide":
        if (n.slice(1).includes(0)) return { error: "divisionByZero" };
        value = n
          .slice(1)
          .reduce((x, y) => safeStep(safeStep(x) / safeStep(y)), a);
        break;
      case "scale":
        if (b === 0) return { error: "originalZero" };
        value = safeStep(safeStep(a) / safeStep(b));
        value = safeStep(value * safeStep(c));
        break;
      case "split": {
        const precision = definition.props.precision ?? 2;
        if (
          !Number.isInteger(b) ||
          !Number.isSafeInteger(b) ||
          b < 1 ||
          b > 10000 ||
          a < 0 ||
          !Number.isInteger(precision) ||
          precision < 0 ||
          precision > 6
        )
          return {
            error: "splitInputs",
          };
        const units = toMinorUnits(a, precision);
        if (units === null) return { error: "amountRange" };
        const divisor = BigInt(b);
        const each = units / divisor;
        const remainder = units % divisor;
        return {
          value: fromMinorUnits(units, precision),
          values: Array.from({ length: b }, (_, i) =>
            fromMinorUnits(
              each + (BigInt(i) < remainder ? BigInt(1) : BigInt(0)),
              precision,
            ),
          ),
        };
      }
      case "weighted": {
        let sum = 0,
          total = 0;
        for (let i = 0; i < n.length; i += 2) {
          if (n[i + 1]! < 0) return { error: "negativeWeight" };
          sum = safeStep(sum + safeStep(n[i]! * n[i + 1]!));
          total = safeStep(total + safeStep(n[i + 1]!));
        }
        if (total === 0) return { error: "zeroWeight" };
        value = safeStep(sum / total);
        break;
      }
    }
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message === "unsafeNumber"
          ? "unsafeNumber"
          : "resultFinite",
    };
  }
  return isSafeCalculationNumber(value) ? { value } : { error: "unsafeNumber" };
}
