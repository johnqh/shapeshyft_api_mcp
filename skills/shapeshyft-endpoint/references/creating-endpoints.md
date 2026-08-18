# Creating an Endpoint

Complete recipes for `create_endpoint`, each showing the four things that have to
agree: the **payload the caller sends**, the **input schema** that documents it,
the **output schema** that shapes the answer, and the **response** that comes back.

Prerequisites for every recipe: an entity slug, an active LLM provider key
(`list_llm_keys` → `uuid` becomes `llm_key_id`), and a project
(`list_projects` → `uuid` becomes `projectId`).

## Anatomy of an endpoint

| Field | Required | What it does |
|---|---|---|
| `endpoint_name` | yes | URL slug — lowercase alphanumeric with interior hyphens, unique in the project. Becomes `/api/v1/ai/:orgPath/:projectName/**:endpointName**` |
| `display_name` | yes | Human-readable name for the dashboard |
| `llm_key_id` | yes | UUID of the stored provider key |
| `model` | no | Model id; omit to use the provider's default |
| `http_method` | no | `POST` (default, JSON body) or `GET` (query parameters) |
| `context` | no | Standing system prompt sent with every call |
| `instructions` | no | The task to perform on this input |
| `input_schema` | no | Documents the caller payload (published contract, not enforced at runtime) |
| `output_schema` | no | The shape the answer must take — this is what makes the endpoint structured |
| `web_search` | no | Enable provider web search (only where the model reports `webSearch`) |
| `expects_media_output` | no | `{ image?, audio?, video? }` for generative models |
| `output_media_format` | no | `base64` (inline) or `url` (signed URL from your bucket) |
| `transcription_extraction_model` | no | Second-pass model for Whisper endpoints |

Omitting `output_schema` does not turn structured output off — the API falls back
to an unconstrained `{ "type": "object" }`, so the model still returns JSON, but
picks its own field names and they drift from call to call. If callers need a
stable shape, the schema is not optional.

## How your payload actually reaches the model

The input object is rendered into the user prompt as a bullet list, one line per
top-level key:

```
Process the following data and generate the structured response:

- text: "You billed me twice this month."
- customer_tier: "enterprise"
```

Consequences worth designing around:

- **Field names are prompt text.** `customer_tier` reads better to a model than
  `ct` or `field2`. Name payload keys the way you would label them for a person.
- Nested objects render one extra level deep; arrays are inlined as JSON. Keep the
  payload shallow for the same reason you keep the output schema shallow.
- Media fields are lifted out and replaced with a placeholder like
  `[Image: receipt]`, then attached as a real image/audio/video block. The field
  name is what the model sees in the text, so name it `receipt`, not `file1`.
- Two keys never reach the model: `context` (overrides the endpoint's system
  context for that call) and `web_search: false` (disables search for that call).
  Do not use those names for real input fields.

---

## Recipe A — Text classification (POST)

The common case: one text field in, a fixed set of fields out.

**Caller sends**

```json
{ "text": "You billed me twice this month and support never replied." }
```

**Create it**

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "classify-ticket",
  display_name: "Classify Support Ticket",
  llm_key_id: "8f1c...",
  model: "claude-sonnet-4-6-20260217",
  context: "You triage support tickets for a B2B SaaS company.",
  instructions: "Classify the ticket, judge sentiment, rate urgency, and summarize it in one sentence.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Raw ticket body as the customer wrote it" }
    },
    required: ["text"]
  },
  output_schema: {
    type: "object",
    properties: {
      category:  { type: "string", enum: ["billing", "bug", "feature", "other"] },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      urgency:   { type: "integer", minimum: 1, maximum: 5,
                   description: "1 = can wait weeks, 3 = normal, 5 = production down" },
      summary:   { type: "string", description: "One sentence, under 30 words" }
    },
    required: ["category", "sentiment", "urgency", "summary"]
  }
})
```

**Invoke**

```
invoke_endpoint({
  projectName: "support-tools",
  endpointName: "classify-ticket",
  input: { text: "You billed me twice this month and support never replied." }
})
```

**Response**

```json
{
  "output": {
    "category": "billing",
    "sentiment": "negative",
    "urgency": 4,
    "summary": "Customer was double-charged and received no support response."
  },
  "usage": {
    "tokens_input": 312, "tokens_output": 48,
    "latency_ms": 1180, "estimated_cost_cents": 0.14
  }
}
```

**Over HTTP**

```bash
curl -X POST https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"text":"You billed me twice this month and support never replied."}'
```

The POST body **is** the input object — it is not wrapped in an `input` envelope.

---

## Recipe B — Several input fields

More fields let the caller supply context the model would otherwise guess at. Each
key becomes its own labeled line in the prompt.

**Caller sends**

```json
{
  "product_name": "Trailhead 40L Pack",
  "features": ["waterproof zippers", "internal frame", "1.2 kg"],
  "audience": "weekend backpackers",
  "brand_voice": "practical, no hype"
}
```

**Create it**

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "write-listing",
  display_name: "Write Product Listing",
  llm_key_id: "8f1c...",
  context: "You write outdoor gear listings for an e-commerce catalog.",
  instructions: "Write a product listing from the supplied attributes. Never invent specifications that are not in the features list.",
  input_schema: {
    type: "object",
    properties: {
      product_name: { type: "string" },
      features:     { type: "array", items: { type: "string" },
                      description: "Factual attributes; the only specs you may state" },
      audience:     { type: "string", description: "Who the listing is aimed at" },
      brand_voice:  { type: "string", description: "Tone to write in" }
    },
    required: ["product_name", "features"]
  },
  output_schema: {
    type: "object",
    properties: {
      title:       { type: "string", maxLength: 70 },
      description: { type: "string", maxLength: 800 },
      bullets:     { type: "array", items: { type: "string" }, description: "3-5 selling points" },
      keywords:    { type: "array", items: { type: "string" }, description: "Search keywords, lowercase" }
    },
    required: ["title", "description", "bullets", "keywords"]
  }
})
```

**Response**

```json
{
  "output": {
    "title": "Trailhead 40L Pack — Waterproof Weekend Backpack",
    "description": "Built for two- and three-day trips...",
    "bullets": ["Waterproof zippers keep gear dry", "Internal frame carries load close", "1.2 kg packed weight"],
    "keywords": ["40l backpack", "waterproof pack", "weekend backpacking"]
  },
  "usage": { "tokens_input": 268, "tokens_output": 214, "latency_ms": 2140, "estimated_cost_cents": 0.31 }
}
```

Optional input fields are genuinely optional: leave `brand_voice` out and the
model simply never sees that line.

---

## Recipe C — Extraction from an image (multimodal)

**Requires** a model reporting `visionInput` — check `list_provider_models` first.

**Caller sends** — a data URL, or a `gs://` URL. Plain `http(s)` URLs are
rejected (SSRF prevention), and the whole request body is capped at 50 MB.

```json
{
  "receipt": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
  "expected_currency": "USD"
}
```

**Create it**

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "read-receipt",
  display_name: "Read Receipt",
  llm_key_id: "<vision-capable-key-uuid>",
  model: "gpt-5.4-mini",
  instructions: "Extract the purchase details from the receipt image. Use the fields_not_found list for anything the image does not show — never guess.",
  input_schema: {
    type: "object",
    properties: {
      receipt:           { type: "string", description: "Receipt image as a data URL or gs:// URL" },
      expected_currency: { type: "string", description: "ISO 4217 code, e.g. USD" }
    },
    required: ["receipt"]
  },
  output_schema: {
    type: "object",
    properties: {
      merchant:     { type: "string" },
      purchased_on: { type: "string", format: "date", description: "ISO 8601, YYYY-MM-DD" },
      total_cents:  { type: "integer", minimum: 0, description: "Total in minor units" },
      currency:     { type: "string", description: "ISO 4217 code" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity:    { type: "integer" },
            unit_cents:  { type: "integer" }
          },
          required: ["description", "quantity", "unit_cents"]
        }
      },
      fields_not_found: { type: "array", items: { type: "string" },
                          description: "Names of fields the image does not show" }
    },
    required: ["merchant", "total_cents", "line_items", "fields_not_found"]
  }
})
```

The image is stripped from the text and attached as an image block; the model sees
`- receipt: "[Image: receipt]"` alongside the other fields. SVG, TIFF, HEIC, BMP,
and AVIF are converted to PNG automatically.

**Response**

```json
{
  "output": {
    "merchant": "Blue Bottle Coffee",
    "purchased_on": "2026-08-14",
    "total_cents": 1875,
    "currency": "USD",
    "line_items": [{ "description": "Latte", "quantity": 2, "unit_cents": 650 }],
    "fields_not_found": ["tax_cents"]
  },
  "usage": { "tokens_input": 1420, "tokens_output": 96, "latency_ms": 3210, "estimated_cost_cents": 0.42 }
}
```

For large or repeated media, prefer `gs://` over base64 — it keeps you under the
body limit and off the token bill for re-uploads.

---

## Recipe D — A GET endpoint

Use `http_method: "GET"` when the caller can only issue a GET (a webhook, a
spreadsheet formula, a browser). Input comes from query parameters, so **every
value arrives as a string** — declare them as strings and let the model coerce, or
keep the payload textual.

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "detect-language",
  display_name: "Detect Language",
  llm_key_id: "8f1c...",
  http_method: "GET",
  instructions: "Identify the language of the supplied text.",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"]
  },
  output_schema: {
    type: "object",
    properties: {
      language_code: { type: "string", description: "ISO 639-1, e.g. 'pt'" },
      language_name: { type: "string" },
      confidence:    { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["language_code", "language_name", "confidence"]
  }
})
```

**Invoke**

```
invoke_endpoint({
  projectName: "support-tools",
  endpointName: "detect-language",
  method: "GET",
  input: { text: "Onde fica a estação de trem?" }
})
```

```bash
curl -G https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/detect-language \
  -H "Authorization: Bearer sk_live_..." \
  --data-urlencode "text=Onde fica a estação de trem?"
```

Two GET-specific traps:

- The method must match `http_method` exactly, or the API answers `405`.
- Every query parameter becomes part of the input. Putting the key in `?api_key=`
  feeds it to the model — send it in the `Authorization` header instead.

---

## Recipe E — Audio transcription plus extraction

Groq Whisper models run two stages: transcribe the audio, then extract structured
data from the transcript with `transcription_extraction_model`. Set both.

**Caller sends**

```json
{ "recording": "gs://my-bucket/calls/2026-08-17/call-123.mp3" }
```

**Create it**

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "call-notes",
  display_name: "Sales Call Notes",
  llm_key_id: "<groq-key-uuid>",
  model: "whisper-large-v3",
  transcription_extraction_model: "llama-3.3-70b-versatile",
  instructions: "Summarize the sales call, list action items, and capture any stated budget.",
  input_schema: {
    type: "object",
    properties: {
      recording: { type: "string", description: "Audio as a gs:// URL or data URL" }
    },
    required: ["recording"]
  },
  output_schema: {
    type: "object",
    properties: {
      summary:        { type: "string", maxLength: 600 },
      action_items:   { type: "array", items: { type: "string" } },
      budget_cents:   { type: ["integer", "null"], description: "null if no budget was stated" },
      next_step_date: { type: ["string", "null"], format: "date" }
    },
    required: ["summary", "action_items", "budget_cents", "next_step_date"]
  }
})
```

Audio format support is narrower than for text models — check
`capabilities.mediaFormats.audioFormats` before committing to a model.

---

## Recipe F — Generated media output

For models that produce images, audio, or video, declare what is coming back and
how you want it delivered.

```
create_endpoint({
  projectId: "b2d4...",
  endpoint_name: "make-hero-image",
  display_name: "Generate Hero Image",
  llm_key_id: "<image-capable-key-uuid>",
  model: "<model with imageOutput>",
  instructions: "Generate a hero image matching the brief and return a short alt text.",
  input_schema: {
    type: "object",
    properties: {
      brief: { type: "string" },
      style: { type: "string", description: "e.g. 'flat illustration', 'photographic'" }
    },
    required: ["brief"]
  },
  output_schema: {
    type: "object",
    properties: { alt_text: { type: "string", maxLength: 140 } },
    required: ["alt_text"]
  },
  expects_media_output: { image: true },
  output_media_format: "url"
})
```

The response carries the structured fields **and** the media:

```json
{
  "output": { "alt_text": "Flat illustration of a backpack on a mountain trail" },
  "generated_media": [
    { "type": "image", "mimeType": "image/png", "data": "https://storage.googleapis.com/...signed..." }
  ],
  "usage": { "tokens_input": 84, "tokens_output": 12, "latency_ms": 8400, "estimated_cost_cents": 4.0 }
}
```

`output_media_format: "url"` needs storage configured first
(`set_storage_config`); signed URLs expire after 7 days. Use `"base64"` to get the
bytes inline instead.

---

## Per-request overrides

Two reserved payload keys change behavior without editing the endpoint:

```json
{
  "text": "The pump seal failed after three weeks.",
  "context": "You triage warranty claims for industrial equipment."
}
```

`context` replaces the endpoint's stored system context for that call only — handy
for testing a different framing before making it permanent. `web_search: false`
disables search for one call; it can never enable search on an endpoint that has
it turned off.

---

## Before you call it done

1. `preview_endpoint_prompt` with a realistic payload. Free, no LLM call. Confirm
   the field labels read sensibly and the output requirements look unambiguous.
2. `invoke_endpoint` with the same payload; check every required field is present
   and correct.
3. Re-run two or three *hard* inputs — edge cases, missing fields, an ambiguous
   case that should land in your `other`/`unknown` enum member.
4. Note `usage.estimated_cost_cents` and multiply by expected volume before
   telling anyone the endpoint is ready.
5. If callers are limited to known hosts, set `ip_allowlist` with
   `update_endpoint`.

Related: `schema-design.md` for why the output schema is the endpoint, and
`model-selection.md` for choosing a provider and model.
