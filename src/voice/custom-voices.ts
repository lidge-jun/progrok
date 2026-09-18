import { createVoiceHttpClient, expectRecord, expectString, jsonBody, type VoiceClientOptions } from "./http.js";

export type VoiceGender = "male" | "female" | "neutral";
export type VoiceAge = "young" | "middle-aged" | "old";
export type VoiceUseCase = "conversational" | "narration" | "characters" | "educational" | "advertisement" | "social_media" | "entertainment";
export type VoiceTone = "warm" | "casual" | "professional" | "friendly" | "authoritative" | "expressive" | "calm";
export interface CustomVoiceMetadataInput { name?: string; description?: string; gender?: VoiceGender; accent?: string; age?: VoiceAge; language?: string; use_case?: VoiceUseCase; tone?: VoiceTone }
export interface CreateCustomVoiceRequest extends CustomVoiceMetadataInput { file: Blob; filename: string }
export interface UpdateCustomVoiceRequest { name?: string | null; description?: string | null; gender?: VoiceGender | null; accent?: string | null; age?: VoiceAge | null; language?: string | null; use_case?: VoiceUseCase | null; tone?: VoiceTone | null }
export interface CustomVoice { voice_id: string; name: string | null; description: string | null; gender: VoiceGender | null; accent: string | null; age: VoiceAge | null; language: string | null; use_case: VoiceUseCase | null; tone: VoiceTone | null; created_at: string }
export interface ListCustomVoicesRequest { limit?: number; pagination_token?: string }
export interface ListCustomVoicesResponse { voices: CustomVoice[]; pagination_token: string | null }
export interface DeleteCustomVoiceResponse { deleted: true }
export interface CustomVoiceAudioResponse { bytes: Uint8Array; contentType: string }
export interface CustomVoicesClient {
  create(request: CreateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>;
  list(request?: ListCustomVoicesRequest, signal?: AbortSignal): Promise<ListCustomVoicesResponse>;
  get(voiceId: string, signal?: AbortSignal): Promise<CustomVoice>;
  update(voiceId: string, request: UpdateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>;
  delete(voiceId: string, signal?: AbortSignal): Promise<DeleteCustomVoiceResponse>;
  getAudio(voiceId: string, signal?: AbortSignal): Promise<CustomVoiceAudioResponse>;
}

const VOICE_ID = /^[a-z0-9]{8}$/;
const MUTABLE_FIELDS = ["name", "description", "gender", "accent", "age", "language", "use_case", "tone"] as const;
function voicePath(voiceId: string, suffix = ""): string {
  if (!VOICE_ID.test(voiceId)) throw new RangeError("custom voice id must be 8 lowercase alphanumeric characters");
  return `/v1/custom-voices/${encodeURIComponent(voiceId)}${suffix}`;
}
function nullableString(value: Record<string, unknown>, key: string): string | null {
  if (value[key] === null || typeof value[key] === "string") return value[key] as string | null;
  throw new TypeError(`${key} must be string or null`);
}
function nullableEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const decoded = nullableString(value, key);
  if (decoded === null) return null;
  if (!allowed.includes(decoded as T)) throw new TypeError(`${key} has an unsupported value`);
  return decoded as T;
}
function decodeCustomVoice(wire: unknown): CustomVoice {
  const value = expectRecord(wire, "custom voice");
  const voiceId = expectString(value, "voice_id");
  if (!VOICE_ID.test(voiceId)) throw new TypeError("invalid custom voice id");
  return {
    voice_id: voiceId, name: nullableString(value, "name"), description: nullableString(value, "description"),
    gender: nullableEnum(value, "gender", ["male", "female", "neutral"]), accent: nullableString(value, "accent"),
    age: nullableEnum(value, "age", ["young", "middle-aged", "old"]), language: nullableString(value, "language"),
    use_case: nullableEnum(value, "use_case", ["conversational", "narration", "characters", "educational", "advertisement", "social_media", "entertainment"]),
    tone: nullableEnum(value, "tone", ["warm", "casual", "professional", "friendly", "authoritative", "expressive", "calm"]),
    created_at: expectString(value, "created_at"),
  };
}
function createForm(request: CreateCustomVoiceRequest): FormData {
  if (!(request.file instanceof Blob) || !request.filename.trim()) throw new RangeError("custom voice file and filename are required");
  const form = new FormData();
  for (const field of MUTABLE_FIELDS) { const value = request[field]; if (value !== undefined) { if (value.length === 0) throw new RangeError(`${field} must not be empty`); form.append(field, value); } }
  form.append("file", request.file, request.filename);
  return form;
}
export function createCustomVoicesClient(options: VoiceClientOptions = {}): CustomVoicesClient {
  const http = createVoiceHttpClient(options);
  return {
    create(request, signal) { return http.requestJson("/v1/custom-voices", { method: "POST", body: createForm(request), signal }, decodeCustomVoice); },
    list(request = {}, signal) {
      if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000)) throw new RangeError("limit must be 1..1000");
      const query = new URLSearchParams();
      if (request.limit !== undefined) query.set("limit", String(request.limit));
      if (request.pagination_token) query.set("pagination_token", request.pagination_token);
      return http.requestJson(`/v1/custom-voices${query.size ? `?${query}` : ""}`, { signal }, (wire) => {
        const value = expectRecord(wire, "custom voice list");
        if (!Array.isArray(value.voices)) throw new TypeError("voices must be array");
        if (!(value.pagination_token === undefined || value.pagination_token === null || typeof value.pagination_token === "string")) throw new TypeError("pagination_token must be string or null");
        return { voices: value.voices.map(decodeCustomVoice), pagination_token: value.pagination_token ?? null } as ListCustomVoicesResponse;
      });
    },
    get(voiceId, signal) { return http.requestJson(voicePath(voiceId), { signal }, decodeCustomVoice); },
    update(voiceId, request, signal) {
      const entries = Object.entries(request);
      if (entries.length === 0) throw new RangeError("custom voice update must contain at least one field");
      if (entries.some(([, value]) => value === "")) throw new RangeError("empty strings are rejected; use null to clear");
      return http.requestJson(voicePath(voiceId), { method: "PATCH", ...jsonBody(request), signal }, decodeCustomVoice);
    },
    delete(voiceId, signal) { return http.requestJson(voicePath(voiceId), { method: "DELETE", signal }, (wire) => { const value = expectRecord(wire, "delete response"); if (value.deleted !== true) throw new TypeError("deleted must be true"); return { deleted: true }; }); },
    getAudio(voiceId, signal) { return http.requestBytes(voicePath(voiceId, "/audio"), { signal }); },
  };
}
