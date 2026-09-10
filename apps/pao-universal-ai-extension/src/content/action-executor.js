// Pao Universal AI Extension — typed action executor.
//
// THIS IS THE ONLY FILE THAT TOUCHES THE DOM, and that is the security boundary. Adapters
// describe intent; this executes it. An adapter cannot reach a node, cannot construct a
// selector, and cannot run a string — which is why dry run can enumerate a job's actions
// before running any of them, and why a policy can forbid one by name.

(function () {
  'use strict';

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  /**
   * Resolve a selector spec for an adapter and a target name.
   *
   * The target NAME is what an adapter names; this resolves it through the adapter's own
   * profile. A page change is a profile edit and never an adapter code change.
   */
  function resolveTarget(adapterId, targetName) {
    const profiles = window.PaoSelectorProfiles;
    if (!profiles) return { found: false, element: null, confidence: 0, strategy: null, stale: false };
    const spec = profiles.specFor(adapterId, targetName);
    if (!spec) return { found: false, element: null, confidence: 0, strategy: null, stale: false };
    const selectors = window.PaoGrokSelectors;
    const resolution = selectors.resolve(spec);
    return {
      found: resolution.found,
      element: resolution.element,
      confidence: resolution.confidence,
      strategy: resolution.strategy,
      stale: resolution.stale,
      detail: resolution.detail,
    };
  }

  function readValue(element) {
    if (!element) return '';
    if ('value' in element && typeof element.value === 'string') return element.value;
    return element.textContent || '';
  }

  /**
   * Normalize for comparison.
   *
   * A rich text field reflows whitespace, so an exact compare would reject a correct
   * injection and block every job. Collapsing whitespace is the narrowest normalization that
   * still catches a truncation or a substitution.
   */
  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function setValue(element, text) {
    element.focus();
    if ('value' in element && typeof element.value === 'string') {
      // A raw assignment does not notify a framework, so the input events are dispatched
      // explicitly. Without them the page state stays empty and submit stays disabled.
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  }

  /**
   * Execute one typed action.
   *
   * Returns a typed outcome rather than throwing, so the caller can distinguish "no prompt
   * field" from "the field rejected our text" — two problems with two different fixes.
   *
   * `dryRun` skips side-effect actions. The check is inside the executor rather than in the
   * caller so a new caller cannot forget it.
   */
  async function execute(action, options) {
    const adapterId = options.adapterId;
    const dryRun = Boolean(options.dryRun);
    const sideEffect = action.type === 'click' || action.type === 'set_text' || action.type === 'upload';

    if (dryRun && sideEffect) {
      return { ok: true, skipped: true, detail: 'Skipped ' + action.type + ' during dry run.' };
    }

    switch (action.type) {
      case 'focus': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_PROMPT_INPUT_NOT_FOUND', detail: 'No element for ' + action.target + '.' };
        target.element.focus();
        return { ok: true, detail: 'Focused ' + action.target + '.' };
      }
      case 'set_text': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_PROMPT_INPUT_NOT_FOUND', detail: 'No element for ' + action.target + '.' };
        // A low-confidence match is reported rather than used: submitting into a field
        // matched only by a weak signal is how a job types into the wrong control.
        if (target.stale) {
          return {
            ok: false,
            code: 'BROWSER_SELECTOR_STALE',
            detail: action.target + ' matched only via ' + target.strategy + ' at confidence ' + Number(target.confidence).toFixed(2) + '.',
          };
        }
        setValue(target.element, action.value);
        const actual = normalize(readValue(target.element));
        const expected = normalize(action.value);
        if (actual !== expected) {
          return {
            ok: false,
            code: 'BROWSER_PROMPT_VERIFY_FAILED',
            detail: 'Expected ' + expected.length + ' characters; the field holds ' + actual.length + '.',
          };
        }
        return { ok: true, detail: 'Text set and verified.', confidence: target.confidence };
      }
      case 'click': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_SELECTOR_STALE', detail: 'No element for ' + action.target + '.' };
        if (target.element.disabled) {
          return { ok: false, code: 'BROWSER_PROMPT_VERIFY_FAILED', detail: action.target + ' is disabled; the page did not accept the input.' };
        }
        target.element.click();
        return { ok: true, detail: 'Clicked ' + action.target + '.' };
      }
      case 'upload': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_UPLOAD_FAILED', detail: 'No file input for ' + action.target + '.' };
        if (!(target.element instanceof HTMLInputElement)) {
          return { ok: false, code: 'BROWSER_UPLOAD_FAILED', detail: action.target + ' is not a file input.' };
        }
        // A file input cannot be populated outside a user gesture. That is a browser
        // boundary rather than a limitation to work around, so the honest answer is to ask
        // for a person — which takes seconds, unlike a privileged API this extension does
        // not request.
        return {
          ok: false,
          code: 'BROWSER_UPLOAD_FAILED',
          detail: 'The page will not accept a programmatic attachment; attach it by hand.',
        };
      }
      case 'wait_for': {
        const satisfied = await waitFor(action.condition, adapterId, options.timeoutMs || 60000);
        return satisfied
          ? { ok: true, detail: 'Condition ' + action.condition.kind + ' satisfied.' }
          : { ok: false, code: 'BROWSER_GENERATION_TIMEOUT', detail: 'Condition ' + action.condition.kind + ' not satisfied in time.' };
      }
      case 'collect_text': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_OUTPUT_NOT_FOUND', detail: 'No result element for ' + action.target + '.' };
        if (target.stale) {
          return { ok: false, code: 'BROWSER_SELECTOR_STALE', detail: 'Result matched only via ' + target.strategy + '; refusing to collect.' };
        }
        return { ok: true, detail: 'Collected text.', text: readValue(target.element), confidence: target.confidence };
      }
      case 'collect_media': {
        const target = resolveTarget(adapterId, action.target);
        if (!target.found) return { ok: false, code: 'BROWSER_OUTPUT_NOT_FOUND', detail: 'No media element for ' + action.target + '.' };
        if (target.stale) {
          return { ok: false, code: 'BROWSER_SELECTOR_STALE', detail: 'Media matched only via ' + target.strategy + '; refusing to collect.' };
        }
        const node = target.element;
        return {
          ok: true,
          detail: 'Collected media.',
          media: [{
            kind: node.tagName === 'VIDEO' ? 'video' : 'image',
            sourceUrl: node.src || node.currentSrc || null,
            width: node.naturalWidth || node.videoWidth || null,
            height: node.naturalHeight || node.videoHeight || null,
            durationSec: node.duration || null,
          }],
          confidence: target.confidence,
        };
      }
      default:
        return { ok: false, code: 'BROWSER_ACTION_FORBIDDEN', detail: 'Unknown action type.' };
    }
  }

  /**
   * Wait for a condition using a mutation-driven check plus a polling backstop.
   *
   * A pure MutationObserver cannot express "this element is ABSENT", because absence is the
   * default and produces no mutation. So absence conditions poll, and everything else is
   * checked on mutation with a slow timer as a safety net.
   */
  function waitFor(condition, adapterId, timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(timer);
        clearTimeout(guard);
        resolve(value);
      };
      const check = () => {
        if (condition.kind === 'idle') return false;
        if (condition.kind === 'text_present') {
          return normalize(document.body ? document.body.innerText : '').includes(normalize(condition.text));
        }
        const target = resolveTarget(adapterId, condition.target);
        if (condition.kind === 'element_present') return target.found && !target.stale;
        if (condition.kind === 'element_absent') return !target.found;
        return false;
      };
      const observer = new MutationObserver(() => {
        if (check()) finish(true);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      const timer = setInterval(() => {
        if (Date.now() > deadline) {
          finish(false);
          return;
        }
        if (check()) finish(true);
      }, 500);
      const guard = setTimeout(() => finish(false), timeoutMs);
      if (check()) finish(true);
    });
  }

  window.PaoActionExecutor = {
    execute: execute,
    resolveTarget: resolveTarget,
    normalize: normalize,
    readValue: readValue,
    isVisible: isVisible,
  };
})();
