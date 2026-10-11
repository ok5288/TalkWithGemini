/** Build-time public rollout policy; persisted definitions remain readable. */
export function isExplorerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER !== "false";
}
