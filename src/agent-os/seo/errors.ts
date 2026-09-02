/** Phase 18 — SEO error hierarchy; never embeds credentials in messages. */

export class SeoError extends Error {
  constructor(message: string, readonly code = "seo_error") {
    super(message);
    this.name = "SeoError";
  }
}
export class SeoConfigurationError extends SeoError {
  constructor(message = "SEO provider is not configured") { super(message, "seo_configuration"); }
}
export class SeoAuthenticationError extends SeoError {
  constructor(message = "SEO provider rejected credentials") { super(message, "seo_authentication"); }
}
export class SeoConnectionError extends SeoError {
  constructor(message = "SEO provider is unreachable") { super(message, "seo_connection"); }
}
export class SeoCapabilityUnavailableError extends SeoError {
  constructor(capability: string) { super(`capability unavailable: ${capability}`, "seo_capability_unavailable"); }
}
export class SeoRateLimitError extends SeoError {
  constructor(message = "SEO provider rate limited the request") { super(message, "seo_rate_limit"); }
}
export class SeoProviderError extends SeoError {
  constructor(message: string) { super(message, "seo_provider"); }
}
export class SeoValidationError extends SeoError {
  constructor(message: string) { super(message, "seo_validation"); }
}
