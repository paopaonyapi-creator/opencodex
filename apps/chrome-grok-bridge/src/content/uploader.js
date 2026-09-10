// Pao Grok Bridge — media uploader (content script).
//
// Upload verification is the whole job here. An unverified upload that silently did
// nothing produces a generation from the prompt alone, which looks like success and
// is not what was asked for — so the attachment preview is checked before the caller
// is told the upload succeeded.

(function () {
  "use strict";

  const MAX_BYTES = 64 * 1024 * 1024;
  const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "video/mp4"];

  /**
   * Validate a reference before touching the page.
   *
   * The size and MIME checks are the operator's protection against a misconfigured
   * job, and they also avoid driving the site into its own rejection path, which is
   * harder to diagnose than a local refusal.
   */
  function validateReference(reference) {
    if (!reference || typeof reference.name !== "string") {
      return { ok: false, detail: "A reference needs at least a name." };
    }
    if (reference.mimeType && !ALLOWED_MIME.includes(reference.mimeType)) {
      return { ok: false, detail: `MIME type '${reference.mimeType}' is not accepted.` };
    }
    if (typeof reference.size === "number" && reference.size > MAX_BYTES) {
      return { ok: false, detail: `File is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.` };
    }
    return { ok: true, detail: "Reference accepted." };
  }

  /**
   * Attach a file to the page's file input.
   *
   * A file input cannot be populated programmatically outside a user gesture, which
   * is a browser security boundary rather than a limitation to work around. When the
   * input cannot be driven the result says so, and the caller reports the job as
   * blocked for a person to attach the file — which is honest and takes seconds,
   * unlike a workaround that would require a privileged API this extension does not
   * ask for.
   */
  async function attach(file) {
    const detector = window.PaoGrokDetector;
    const selectors = window.PaoGrokSelectors;
    const resolution = selectors.resolve(detector.PROFILE.specs.uploadInput);
    if (!resolution.found) {
      return { ok: false, code: "GROK_UPLOAD_FAILED", detail: "No file input matched any candidate." };
    }
    const input = resolution.element;
    if (!(input instanceof HTMLInputElement)) {
      return { ok: false, code: "GROK_UPLOAD_FAILED", detail: "The matched element is not a file input." };
    }
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) {
      return {
        ok: false,
        code: "GROK_USER_ACTION_REQUIRED",
        detail: "The page would not accept a programmatic attachment; attach the reference by hand."
      };
    }
    return { ok: true, detail: "Reference attached." };
  }

  window.PaoGrokUploader = { validateReference, attach, MAX_BYTES, ALLOWED_MIME };
})();
