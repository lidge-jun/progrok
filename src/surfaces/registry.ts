export type SurfaceEvidence = "inventory" | "official-guide" | "openapi-only";

export interface SurfaceDescriptor {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "WS" | "*";
  path: string;
  family: string;
  transport:
    | "json"
    | "multipart"
    | "binary"
    | "async"
    | "websocket"
    | "passthrough";
  evidence: SurfaceEvidence;
}

export const SURFACE_REGISTRY = [
  { method: "POST", path: "/v1/chat/completions", family: "chat", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/chat/deferred-completion/{request_id}", family: "chat", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/responses", family: "responses", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/responses/compact", family: "responses", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/responses/{response_id}", family: "responses", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/responses/{response_id}", family: "responses", transport: "json", evidence: "inventory" },
  // Responses input_items is OpenAPI-only.
  { method: "GET", path: "/v1/responses/{response_id}/input_items", family: "responses", transport: "json", evidence: "openapi-only" },
  { method: "WS", path: "wss://api.x.ai/v1/responses", family: "responses", transport: "websocket", evidence: "official-guide" },
  { method: "POST", path: "/v1/completions", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/messages", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/complete", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/tts", family: "voice", transport: "binary", evidence: "inventory" },
  { method: "GET", path: "/v1/tts/voices", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/tts/voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/stt", family: "voice", transport: "multipart", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/client_secrets", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/custom-voices", family: "voice", transport: "multipart", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "PATCH", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices/{voice_id}/audio", family: "voice", transport: "binary", evidence: "inventory" },
  { method: "POST", path: "/v2/phone-numbers", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/calls/{call_id}/refer", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/calls/{call_id}/hangup", family: "voice", transport: "json", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/realtime", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/tts", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/stt", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "POST", path: "/v1/batches", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}/requests", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/batches/{batch_id}/requests", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}/results", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/batches/{batch_id}:cancel", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/files", family: "files", transport: "multipart", evidence: "inventory" },
  { method: "GET", path: "/v1/files", family: "files", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/files/{file_id}", family: "files", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/files/{file_id}", family: "files", transport: "json", evidence: "inventory" },
  // The following file extensions are OpenAPI-only.
  { method: "GET", path: "/v1/files/{file_id}/content", family: "files", transport: "binary", evidence: "openapi-only" },
  { method: "POST", path: "/v1/files/{file_id}/public-url", family: "files", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/files/{file_id}/public-url/revoke", family: "files", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/documents/search", family: "collections", transport: "json", evidence: "inventory" },
  // Embeddings and embedding model discovery are OpenAPI-only.
  { method: "POST", path: "/v1/embeddings", family: "embeddings", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/embedding-models", family: "embeddings", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/embedding-models/{model_id}", family: "embeddings", transport: "json", evidence: "openapi-only" },
  // Skills CRUD and content are OpenAPI-only.
  { method: "GET", path: "/v1/skills", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/skills", family: "skills", transport: "multipart", evidence: "openapi-only" },
  { method: "GET", path: "/v1/skills/{skill_id}", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "DELETE", path: "/v1/skills/{skill_id}", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/skills/{skill_id}/content", family: "skills", transport: "binary", evidence: "openapi-only" },
  { method: "GET", path: "/v1/models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/language-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/language-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/image-generation-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/image-generation-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/video-generation-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/video-generation-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/tokenize-text", family: "misc", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/api-key", family: "misc", transport: "json", evidence: "inventory" },
  // Account identity at /v1/me is OpenAPI-only.
  { method: "GET", path: "/v1/me", family: "misc", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/images/generations", family: "images", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/images/edits", family: "images", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/generations", family: "videos", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/edits", family: "videos", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/extensions", family: "videos", transport: "async", evidence: "inventory" },
  { method: "GET", path: "/v1/videos/{request_id}", family: "videos", transport: "async", evidence: "inventory" },
  { method: "*", path: "/v1/*", family: "proxy", transport: "passthrough", evidence: "inventory" },
] as const satisfies readonly SurfaceDescriptor[];
