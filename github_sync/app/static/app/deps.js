/**
 * Single entry point for the vendored browser runtime.
 *
 * The panel runs inside Home Assistant Ingress with no build step and no
 * network access, so Preact + hooks + signals + htm are committed under
 * `static/lib/` and wired together here:
 *
 *   - `html` is htm bound to Preact's `h`, which gives JSX-like templates
 *     without a compiler.
 *   - Re-exports keep every module importing the *same* Preact instance, so
 *     `@preact/signals` can hook Preact's render options.
 *
 * Re-vendor with `.github/scripts/vendor_frontend.sh` (see `lib/README.md`).
 */
import { h } from "../lib/preact.module.js";
import htm from "../lib/htm.module.js";

export const html = htm.bind(h);

export { h };
export {
  Component,
  Fragment,
  cloneElement,
  createContext,
  createElement,
  createRef,
  hydrate,
  isValidElement,
  options,
  render,
  toChildArray,
} from "../lib/preact.module.js";
export {
  useCallback,
  useContext,
  useEffect,
  useErrorBoundary,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "../lib/hooks.module.js";
export { Signal, batch, computed, effect, signal, untracked } from "../lib/signals-core.module.js";
export { useComputed, useSignal, useSignalEffect } from "../lib/signals.module.js";
