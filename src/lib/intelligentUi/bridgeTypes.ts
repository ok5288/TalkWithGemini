export type UiSendResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      code:
        | "cancelled"
        | "busy"
        | "inactive"
        | "offline"
        | "model_unavailable"
        | "invalid_message"
        | "user_action_required"
        | "send_failed";
    };

export type UiSendMessage = (text: string) => Promise<UiSendResult>;

export interface UiEnvironment {
  colorScheme: "light" | "dark";
  color: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  variables: Record<string, string>;
}
