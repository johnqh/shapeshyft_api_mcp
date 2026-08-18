# Choosing a Provider and Model

`list_provider_models({ provider })` is the source of truth: it returns
`{ id, capabilities, pricing }` straight from the API, so it is current even when
this file is not. Read it before setting `model` on an endpoint.

## Decision order

1. **Modality first.** Filter to models whose `capabilities` cover what the task
   needs. This is a hard constraint — invocation fails when the model cannot
   accept the media you send.

   | Need | Capability |
   |---|---|
   | Image input | `visionInput` |
   | Audio input | `audioInput` |
   | Video input | `videoInput` |
   | Generated images / audio / video | `imageOutput` / `audioOutput` / `videoOutput` |
   | Search-grounded answers | `webSearch` |

   `undefined` means *unknown*, not supported — verify it yourself before relying
   on it.

2. **Check accepted encodings.** `capabilities.mediaFormats` lists the input
   formats per media type (`url`, `base64`, `gcs`, `s3`, `file`). A model that
   does vision but not `gcs` cannot read your `gs://` URLs.

3. **Then cost.** `pricing` is in cents: `input`/`output` per 1M tokens, image
   prices per image, audio and video per minute. Estimate per call as
   `(input_tokens/1e6 × input) + (output_tokens/1e6 × output)`. After the first
   real invocation, `usage.estimated_cost_cents` gives you the actual figure —
   multiply by expected volume before committing.

4. **Then capability headroom.** Extraction with a tight schema runs fine on small
   models. Nuanced judgment, long documents, and deep nesting need a frontier
   model. Start where the task's difficulty sits, not at the top of the list.

## Provider notes

| Provider | Structured output | Fits |
|---|---|---|
| `anthropic` | `tool_use` | Nuanced judgment, long context, careful instruction-following |
| `openai` | Function calling | General purpose, audio I/O, web search on supported models |
| `gemini` | Native `responseSchema` | Multimodal input, image generation on preview models |
| `groq` | Function calling | Latency-sensitive classification; Whisper transcription |
| `mistral`, `cohere`, `xai`, `deepseek` | Function calling (OpenAI-compatible) | Cost-sensitive volume work |
| `perplexity` | Function calling | Answers that must be grounded in current web results |
| `lm_studio` | Prompt + JSON extraction | Self-hosted, private, or offline; no per-token cost |

Mistral, Cohere, xAI, DeepSeek, and Perplexity all run through the
OpenAI-compatible implementation inside the API.

## Structured-output reliability

Native mechanisms (function calling, `tool_use`, `responseSchema`) constrain the
model's decoding, so conformance is close to guaranteed. `lm_studio` and other
custom servers fall back to prompt instructions plus JSON extraction, which is
best-effort — keep those schemas small, flat, and heavily described, and test more
inputs before trusting them.

## Cost control

- Bound open-ended string fields; output tokens are usually the expensive half.
- Drop `reasoning`/`evidence` fields once quality is proven, if you are paying for
  them at volume.
- Route by difficulty: a cheap model for the common case, an expensive one only
  for flagged inputs. Two endpoints, one caller-side branch.
- `get_analytics` shows real spend per endpoint. Check it before optimizing —
  concentration is usually in one endpoint, not spread evenly.

## Special cases

**Transcription.** Groq's `whisper-large-v3` and `whisper-large-v3-turbo` run a
two-stage pipeline: transcribe, then extract structured data from the transcript
with `transcription_extraction_model`. Set both; the extraction model is an
ordinary text model such as `llama-3.3-70b-versatile`.

**Generated media.** Set `expects_media_output` for the types the model produces
and `output_media_format` to `base64` (inline bytes) or `url` (uploaded to the
entity's bucket, signed for 7 days — configure storage first with
`set_storage_config`).

**Web search.** Only applies where `capabilities.webSearch` is true. A caller can
pass `web_search: false` to disable it for one call, but can never enable it on an
endpoint that has it off.

**Self-hosted.** Store an `lm_studio` key with `endpoint_url` pointing at any
OpenAI-compatible server (LM Studio, vLLM, Ollama's compatible API). Any model
name is accepted since that server owns the namespace.

## Changing your mind later

`update_endpoint({ model })` swaps the model in place; the URL and schema do not
change. Re-run your saved failing inputs afterwards — a cheaper model often holds
up on the easy cases and drops the hard ones, which only shows up if you test
those specifically.
