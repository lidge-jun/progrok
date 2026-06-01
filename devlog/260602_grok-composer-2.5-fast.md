# grok-composer-2.5-fast API Surface Discovery

Date: 2026-06-02

## Discovery

Grok Build's composer model was probed on xAI `/v1/chat/completions`.

### API Probe Results

| Model | HTTP | Error |
|-------|------|-------|
| `grok-composer-2.5-fast` | **200** | None — **responds** |
| `grok-composer-2.5` | 400 | "does not exist or your team does not have access" |
| `composer-2.5-fast` | 400 | "Model not found" |
| `composer-2.5` | 400 | "Model not found" |
| `cursor-composer-2.5` | 400 | "Model not found" |

### Model Capabilities

- **Endpoint**: `/v1/chat/completions` (same as grok-4.3)
- **reasoning_content**: Supported (returned in response)
- **System prompt**: Works
- **Multi-turn**: Works
- **stop sequences**: HTTP 400 — not supported
- **temperature**: Works (0 accepted)
- **Not in /v1/models**: Hidden model, not listed
- **Not in /v1/language-models**: Hidden, no pricing metadata
- **Pricing (from response)**: `cost_in_usd_ticks: ~22M-27M` per request (~$0.002-0.003)

### Response Shape

```json
{
  "model": "grok-composer-2.5-fast",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "...",
      "reasoning_content": "...",
      "refusal": null
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 177,
    "total_tokens": 191,
    "cost_in_usd_ticks": 26970000
  }
}
```

### Key Observation

The model outputs `<tool_call>` with `Write(path=..., contents=...)` in content —
it behaves like a coding agent model similar to Cursor's Composer 2.5 (which is
based on Kimi K2.5). The `grok-composer-*` naming suggests xAI is building or
hosting their own variant through the same API surface.

## Downstream Updates

| Project | Change | Status |
|---------|--------|--------|
| **progrok** | Added to README, SKILL.md, models.ts [composer] tag | Pushed (925b860) |
| **cli-jaw** | Added to registry, cursor-runtime, frontend, constants, contracts | Pushed (b939f415) |
| **hermes-agent** | PR #36968 — added to xAI model list | Submitted |
| **openclaw** | PR #89190 — added to xAI model catalog + prefixes | Submitted |
| **opencode** | Added to xai.go model definitions | Fork branch pushed (af5ed12); upstream archived — PR blocked |

## Smoke Test Summary

| Probe | Result |
|-------|--------|
| Basic chat | PASS (HTTP 200) |
| System prompt | PASS |
| Multi-turn | PASS |
| Temperature 0 | PASS |
| Stop sequences | FAIL (400 — unsupported) |

## Notes

- `grok-composer-2.5` (non-fast) exists in xAI's system but requires team access
- Cursor's Composer 2.5 is a different model (Kimi K2.5 based) — not the same as grok-composer
- Effort/reasoning_effort parameter is not tested — grok-build doesn't support it
