export function isDraftLiveEnabled(value: string | undefined = process.env.DRAFT_LIVE_ENABLED): boolean {
  return value !== "false";
}
