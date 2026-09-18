export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type MessageContentPart =
  | { type: "text" | "input_text" | "output_text"; text: string }
  | {
      type: "image_url" | "input_image";
      image_url: string;
      detail?: "auto" | "low" | "high";
    };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CanonicalMessage {
  role: MessageRole;
  content: string | readonly MessageContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: readonly ToolCall[];
}

export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JsonObject;
    strict?: boolean;
  };
}

export type HostedTool =
  | ({ type: "web_search" } & JsonObject)
  | ({ type: "x_search" } & JsonObject)
  | ({ type: "code_interpreter" } & JsonObject)
  | ({ type: "file_search" } & JsonObject)
  | ({ type: "mcp" } & JsonObject);

export type ToolDefinition = FunctionTool | HostedTool;

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatCompletionsRequest {
  model: string;
  messages: readonly CanonicalMessage[];
  tools?: readonly ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export type ResponsesInputItem =
  | CanonicalMessage
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ResponsesRequest {
  model?: string;
  input: string | readonly ResponsesInputItem[];
  instructions?: string;
  tools?: readonly ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  background?: boolean;
  store?: boolean;
  previous_response_id?: string;
  conversation?: string | { id: string };
  include?: readonly string[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Readonly<Record<string, string>>;
}
