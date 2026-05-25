/**
 * Translate the raw error string returned by `window.api.testLLM` into a
 * user-facing message. The connector hands back things like
 * `HTTP 401: {"error":{"message":"Invalid Authentication", ...}}` or a Node
 * network error like `ENOTFOUND api.example.com` — useful for logs, useless
 * to a human staring at the setup wizard.
 *
 * Returned `title` is the one-liner shown prominently, `hint` is the
 * actionable follow-up. `raw` is preserved so the UI can offer a
 * collapsible "Show details" for debugging.
 */
export interface TestErrorView {
  title: string
  hint?: string
  raw: string
}

export function translateTestError(raw: string): TestErrorView {
  const r = raw || ""
  const lower = r.toLowerCase()

  // --- Auth ---
  if (
    /\bhttp 401\b/i.test(r) ||
    lower.includes("invalid authentication") ||
    lower.includes("invalid_authentication") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication_error") ||
    lower.includes("unauthorized")
  ) {
    return {
      title: "Invalid API key",
      hint: "Double-check the key value. Some providers prefix keys with sk- or msk-.",
      raw: r,
    }
  }

  if (/\bhttp 403\b/i.test(r) || lower.includes("forbidden")) {
    return {
      title: "API key rejected",
      hint: "The key is valid but doesn't have access to this model or endpoint. Check your provider plan or model permissions.",
      raw: r,
    }
  }

  // --- Not found / model issues ---
  if (
    lower.includes("model_not_found") ||
    lower.includes("model not found") ||
    lower.includes("does not exist")
  ) {
    return {
      title: "Model not found",
      hint: "The model name isn't recognized by this provider. Check spelling, or leave it blank to use the default.",
      raw: r,
    }
  }

  if (/\bhttp 404\b/i.test(r)) {
    return {
      title: "Endpoint not found",
      hint: "Check the base URL — it should usually end in /v1 for OpenAI-compatible providers.",
      raw: r,
    }
  }

  // --- Rate limit / quota ---
  if (
    /\bhttp 429\b/i.test(r) ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit")
  ) {
    return {
      title: "Rate limited",
      hint: "Too many requests right now. Wait a moment and try again.",
      raw: r,
    }
  }

  if (lower.includes("insufficient_quota") || lower.includes("quota")) {
    return {
      title: "Quota exceeded",
      hint: "Your account is out of credits or has hit a usage cap.",
      raw: r,
    }
  }

  // --- Server-side ---
  if (/\bhttp 5\d\d\b/i.test(r)) {
    return {
      title: "Provider is having issues",
      hint: "The API server returned an error. This is usually temporary — try again in a moment.",
      raw: r,
    }
  }

  // --- Network ---
  if (lower.includes("timed out") || lower.includes("etimedout")) {
    return {
      title: "Connection timed out",
      hint: "The server didn't respond. Check the base URL and your network.",
      raw: r,
    }
  }

  if (lower.includes("enotfound") || lower.includes("eai_again")) {
    return {
      title: "Server not found",
      hint: "Couldn't resolve the host. Double-check the base URL.",
      raw: r,
    }
  }

  if (lower.includes("econnrefused")) {
    return {
      title: "Connection refused",
      hint: "Nothing is listening at that address. Check the base URL and port.",
      raw: r,
    }
  }

  if (
    lower.includes("self-signed certificate") ||
    lower.includes("self signed") ||
    lower.includes("unable to verify") ||
    lower.includes("cert_")
  ) {
    return {
      title: "TLS certificate problem",
      hint: "The server's certificate couldn't be verified.",
      raw: r,
    }
  }

  // --- App-level ---
  if (lower.includes("no api key")) {
    return {
      title: "API key is required",
      hint: "Fill in the key field above before testing.",
      raw: r,
    }
  }

  if (lower.includes("invalid response")) {
    return {
      title: "Unexpected server response",
      hint: "The endpoint didn't return valid JSON. Make sure the base URL points to an OpenAI-compatible API.",
      raw: r,
    }
  }

  // --- Fallback ---
  return {
    title: "Connection test failed",
    hint: r ? undefined : "Try again or skip this step.",
    raw: r,
  }
}
