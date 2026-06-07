export interface Config {
  groupme: {
    access_token: string;
    bot_id: string;
    group_id: string;
    allowed_sender_id: string;
  };
  agent: {
    workspace_dir: string;
    model: string;
    max_turns: number;
    auto_allow_read_tools: boolean;
  };
  server: { port: number };
  tunnel: { mode: "named" | "quick"; hostname: string };
}

// The JSON GroupMe POSTs to the callback URL on every group message.
export interface GroupMeCallback {
  id: string;
  text: string | null;
  name: string;
  sender_id: string;
  sender_type: "user" | "bot" | "system";
  group_id: string;
  created_at: number;
  attachments: unknown[];
}

// What the gateway decides to do with an incoming callback.
export type Decision =
  | { kind: "ignore" }
  | { kind: "confirm"; allowed: boolean }
  | { kind: "command"; text: string }
  | { kind: "prompt"; text: string };

// Mirrors the Agent SDK PermissionResult shape we use.
export type PermissionResult =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };
