export const HTML_RUNTIME_LIMITS = Object.freeze({
  stateBytes: 256 * 1024,
  snapshotBytes: 64 * 1024,
  summaryBytes: 8 * 1024,
  depth: 24,
  height: 16384,
  updateMs: 100,
  messagesPerSecond: 60,
  burst: 120,
  requests: 1024,
});

/** Self-contained: also embedded in the sandbox before generated scripts run. */
export function createHtmlRuntimeGuards(limits: typeof HTML_RUNTIME_LIMITS) {
  const getPrototype = Object.getPrototypeOf;
  const descriptor = Object.getOwnPropertyDescriptor;
  const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (
    value: object,
    key: string,
  ) => boolean;
  const isArray = Array.isArray;
  const finite = Number.isFinite;
  const create = Object.create;
  const charCode = Function.prototype.call.bind(
    String.prototype.charCodeAt,
  ) as (value: string, index: number) => number;
  const WeakSetConstructor = WeakSet;
  const ErrorConstructor = Error;
  function countString(value: string, maximum: number, json: boolean): number {
    let size = json ? 2 : 0;
    for (let index = 0; index < value.length; index++) {
      const code = charCode(value, index);
      if (json && (code === 34 || code === 92)) size += 2;
      else if (json && code < 32)
        size += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = charCode(value, index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          size += 4;
          index++;
        } else size += json ? 6 : 3;
      } else if (code >= 0xdc00 && code <= 0xdfff) size += json ? 6 : 3;
      else size += 3;
      if (size > maximum) throw new ErrorConstructor("runtime_limit");
    }
    if (size > maximum) throw new ErrorConstructor("runtime_limit");
    return size;
  }
  function state(value: unknown): Record<string, unknown> {
    let bytes = 0;
    const ancestors = new WeakSetConstructor<object>();
    const consume = (count: number) => {
      bytes += count;
      if (bytes > limits.stateBytes)
        throw new ErrorConstructor("runtime_limit");
    };
    const plain = (item: object) => {
      const prototype = getPrototype(item);
      return prototype === null || getPrototype(prototype) === null;
    };
    const visit = (item: unknown, depth: number): unknown => {
      if (depth > limits.depth) throw new ErrorConstructor("runtime_limit");
      if (item === null) {
        consume(4);
        return null;
      }
      if (typeof item === "string") {
        consume(countString(item, limits.stateBytes - bytes, true));
        return item;
      }
      if (typeof item === "boolean") {
        consume(item ? 4 : 5);
        return item;
      }
      if (typeof item === "number" && finite(item)) {
        consume(String(item).length);
        return item;
      }
      if (typeof item !== "object" || !item)
        throw new ErrorConstructor("invalid_state");
      if (ancestors.has(item)) throw new ErrorConstructor("invalid_state");
      ancestors.add(item);
      consume(2);
      let output: unknown;
      if (isArray(item)) {
        const array: unknown[] = [];
        for (let index = 0; index < item.length; index++) {
          if (index) consume(1);
          const property = descriptor(item, String(index));
          if (!property || !("value" in property))
            throw new ErrorConstructor("invalid_state");
          array[index] = visit(property.value, depth + 1);
        }
        output = array;
      } else {
        if (!plain(item)) throw new ErrorConstructor("invalid_state");
        const object = create(null) as Record<string, unknown>;
        let count = 0;
        for (const key in item) {
          if (!own(item, key)) continue;
          if (count++) consume(1);
          consume(countString(key, limits.stateBytes - bytes, true) + 1);
          const property = descriptor(item, key);
          if (!property || !("value" in property))
            throw new ErrorConstructor("invalid_state");
          object[key] = visit(property.value, depth + 1);
        }
        output = object;
      }
      ancestors.delete(item);
      return output;
    };
    if (!value || typeof value !== "object" || isArray(value) || !plain(value))
      throw new ErrorConstructor("invalid_state");
    return visit(value, 0) as Record<string, unknown>;
  }
  return Object.freeze({
    state,
    text(value: unknown, maximum: number): string {
      if (typeof value !== "string")
        throw new ErrorConstructor("invalid_update");
      countString(value, maximum, false);
      return value;
    },
    height(value: unknown): number {
      if (typeof value !== "number" || !finite(value) || value < 0)
        throw new ErrorConstructor("invalid_update");
      return Math.min(limits.height, Math.ceil(value));
    },
  });
}
