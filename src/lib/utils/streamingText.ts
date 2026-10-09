/**
 * Tracks a stream whose callback receives the complete generated text on each
 * update (for example, `A`, then `AB`, then `ABC`).
 */
export function createStreamingReplacement(originalText: string) {
  let latestText = "";

  return {
    replace(snapshot: string): string {
      latestText = snapshot;
      return latestText;
    },
    value(): string {
      return latestText;
    },
    restore(): string {
      return originalText;
    },
  };
}
