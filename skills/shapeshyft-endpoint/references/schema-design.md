# Designing Output Schemas

The output schema is the endpoint. ShapeShyft compiles it into the provider's
native structured-output mechanism — OpenAI/Groq function calling, Anthropic
`tool_use`, Gemini `responseSchema`, prompt instructions plus JSON extraction for
self-hosted servers — so the schema is simultaneously the contract, the
validation, and a large part of the prompt. A vague schema produces vague output
no amount of instruction text repairs.

## Rules that change results

### Describe every field the model could misread

`description` text is fed to the model. This is where you disambiguate.

```json
// Weak
{ "urgency": { "type": "integer" } }

// Strong
{ "urgency": { "type": "integer", "minimum": 1, "maximum": 5,
    "description": "1 = can wait weeks, 3 = normal, 5 = production down right now" } }
```

### Constrain anything you will branch on

If your code does `if (result.category === "billing")`, the field must be an enum.
Free-text categories drift across calls ("Billing", "billing issue", "payments").

```json
{ "category": { "type": "string", "enum": ["billing", "bug", "feature", "other"] } }
```

Always include a fallback member (`other`, `unknown`) so the model has somewhere
to put genuinely ambiguous cases instead of forcing a wrong one.

### Mark required fields required

Optional fields get skipped. If downstream code reads it, it belongs in
`required`. If it truly is optional, allow the empty case explicitly:

```json
{ "refund_amount_cents": { "type": ["integer", "null"],
    "description": "null when no refund was requested" } }
```

### Use integers for money

`total_cents` as an integer, never `total` as a float. Floating point amounts come
back as `19.989999` often enough to matter.

### Keep it shallow

Two or three levels stay reliable across every provider. Deeply nested objects
degrade fastest on smaller and self-hosted models. Flatten where you can:

```json
// Instead of customer.address.billing.postal_code
{ "billing_postal_code": { "type": "string" } }
```

### Order fields so reasoning precedes conclusions

Models fill fields in order. Putting a short `reasoning` or `evidence` field
before the verdict measurably improves the verdict, because the answer is written
after the justification rather than rationalized backwards.

```json
{
  "type": "object",
  "properties": {
    "evidence": { "type": "string", "description": "The sentence that determined the classification" },
    "category": { "type": "string", "enum": ["billing", "bug", "feature", "other"] }
  },
  "required": ["evidence", "category"]
}
```

Drop the field if you do not want to pay for those tokens — but measure first.

### Ask for arrays of objects, not delimited strings

```json
// Instead of "action_items": { "type": "string" }  ("1. Call back  2. Refund")
{ "action_items": { "type": "array", "items": { "type": "string" } } }
```

### Bound open-ended text

`maxLength`, or a description like "at most one sentence". Unbounded summary
fields are where token costs quietly grow.

## Instructions vs. context vs. schema

Three places carry meaning; putting things in the wrong one is a common cause of
mediocre output.

| Field | Holds | Example |
|---|---|---|
| `context` | Standing background true for every call | "You triage support tickets for a B2B SaaS company. Enterprise customers are on annual contracts." |
| `instructions` | The task to perform on this input | "Classify the ticket, judge sentiment, and summarize it in one sentence." |
| `output_schema` | The shape of the answer | field names, types, enums, descriptions |

Do not describe the output format in `instructions` ("return JSON with a category
field..."). The schema already does that, and the duplicate drifts out of sync the
first time you edit one of them.

## Patterns

### Classification

```json
{
  "type": "object",
  "properties": {
    "category":   { "type": "string", "enum": ["billing", "bug", "feature", "other"] },
    "sentiment":  { "type": "string", "enum": ["positive", "neutral", "negative"] },
    "urgency":    { "type": "integer", "minimum": 1, "maximum": 5 },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1,
                    "description": "0-1; below 0.5 means route to a human" }
  },
  "required": ["category", "sentiment", "urgency", "confidence"]
}
```

A confidence field gives you a cheap routing rule for the cases the model is
unsure about.

### Document extraction

```json
{
  "type": "object",
  "properties": {
    "invoice_number": { "type": "string" },
    "issued_on":      { "type": "string", "format": "date", "description": "ISO 8601, YYYY-MM-DD" },
    "vendor_name":    { "type": "string" },
    "total_cents":    { "type": "integer", "minimum": 0 },
    "line_items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "quantity":    { "type": "integer" },
          "unit_cents":  { "type": "integer" }
        },
        "required": ["description", "quantity", "unit_cents"]
      }
    },
    "fields_not_found": {
      "type": "array", "items": { "type": "string" },
      "description": "Names of requested fields absent from the document"
    }
  },
  "required": ["invoice_number", "total_cents", "line_items", "fields_not_found"]
}
```

`fields_not_found` is the antidote to hallucinated extractions: it gives the model
a legitimate place to admit a field was missing.

### Rewriting or generation

```json
{
  "type": "object",
  "properties": {
    "rewritten":       { "type": "string", "maxLength": 600 },
    "changes_made":    { "type": "array", "items": { "type": "string" } },
    "tone":            { "type": "string", "enum": ["formal", "neutral", "casual"] }
  },
  "required": ["rewritten", "changes_made", "tone"]
}
```

### Multimodal input

Media rides inside the normal input payload as a data URL or a `gs://` URL —
plain `http(s)` URLs are rejected to prevent SSRF. The output schema describes
what you want extracted; nothing special is needed there.

```json
{ "receipt": "data:image/png;base64,iVBORw0KGgo...", "note": "Extract merchant and total." }
```

Confirm the model reports `visionInput` (or `audioInput` / `videoInput`) via
`list_provider_models` first, and keep the whole request under the 50 MB body
limit — that ceiling is why `gs://` beats base64 for large media.

## Where these go

`references/creating-endpoints.md` shows each of these schemas in a complete
`create_endpoint` call, paired with the caller payload it accepts and the response
it produces.

## Iterating

1. `preview_endpoint_prompt` with a realistic input — free, shows what the model
   is actually told.
2. `invoke_endpoint` with the same input; compare the result field by field.
3. Change **one** thing, re-run the same input, compare again.
4. Keep three or four inputs that previously failed and re-run all of them after
   each change — schema edits that fix one case routinely break another.
