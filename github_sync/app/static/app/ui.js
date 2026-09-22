/**
 * Design-system primitives.
 *
 * Small, predictable building blocks (icons, buttons, cards, modal, toasts)
 * so views stay about *content* and the visual language stays consistent.
 * Everything reads its colours from CSS custom properties in `styles.css`.
 */
import { Fragment, html, useEffect, useRef } from "./deps.js";

/* -------------------------------------------------------------------- icons */

const ICONS = {
  github: { fill: true, d: "M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.96.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" },
  refresh: { d: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" },
  check: { d: "M20 6 9 17l-5-5" },
  close: { d: "M18 6 6 18M6 6l12 12" },
  upload: { d: "M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" },
  download: { d: "M8 17l4 4 4-4M12 12v9M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" },
  folder: { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" },
  file: { d: "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7" },
  branch: { d: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" },
  sliders: { d: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" },
  shield: { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
  key: { d: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" },
  warning: { d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" },
  info: { d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" },
  sparkles: { d: "M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" },
  plus: { d: "M12 5v14M5 12h14" },
  trash: { d: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" },
  pencil: { d: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" },
  chevronRight: { d: "M9 18l6-6-6-6" },
  chevronDown: { d: "M6 9l6 6 6-6" },
  back: { d: "M19 12H5M12 19l-7-7 7-7" },
  user: { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  logout: { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" },
  search: { d: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" },
  external: { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" },
  lock: { d: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" },
  copy: { d: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" },
  clock: { d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" },
  zap: { d: "M13 2 3 14h9l-1 8 10-12h-9z" },
  eye: { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  layers: { d: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" },
  terminal: { d: "M4 17l6-6-6-6M12 19h8" },
};

/** Inline SVG icon from the shared 24×24 set. */
export function Icon({ name, size = 18, className = "", title }) {
  const icon = ICONS[name] || ICONS.info;
  return html`<svg
    class=${`icon ${className}`}
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    aria-hidden=${title ? "false" : "true"}
    role=${title ? "img" : undefined}
    focusable="false"
  >
    ${title ? html`<title>${title}</title>` : null}
    <path
      d=${icon.d}
      fill=${icon.fill ? "currentColor" : "none"}
      stroke=${icon.fill ? "none" : "currentColor"}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`;
}

/* ------------------------------------------------------------------ buttons */

/** Button with variants: primary (default), ok, danger, ghost, subtle. */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  trailingIcon,
  busy: isBusy = false,
  disabled = false,
  type = "button",
  className = "",
  title,
  onClick,
  children,
}) {
  const classes = ["btn", variant, size === "sm" ? "sm" : "", className].filter(Boolean).join(" ");
  return html`<button
    type=${type}
    class=${classes}
    title=${title}
    disabled=${disabled || isBusy}
    onClick=${onClick}
  >
    ${isBusy ? html`<${Spinner} size=${14} />` : icon ? html`<${Icon} name=${icon} size=${size === "sm" ? 15 : 17} />` : null}
    ${children ? html`<span class="btn-label">${children}</span>` : null}
    ${trailingIcon ? html`<${Icon} name=${trailingIcon} size=${15} />` : null}
  </button>`;
}

/** Round icon-only button. */
export function IconButton({ name, label, onClick, spin = false, className = "", disabled = false }) {
  return html`<button
    type="button"
    class=${`icon-btn ${className} ${spin ? "spin" : ""}`.trim()}
    title=${label}
    aria-label=${label}
    disabled=${disabled}
    onClick=${onClick}
  >
    <${Icon} name=${name} size=${18} />
  </button>`;
}

/* --------------------------------------------------------------- containers */

/** Surface card with an optional header row. */
export function Card({ title, subtitle, icon, actions, children, className = "", tone = "" }) {
  return html`<section class=${`card ${tone} ${className}`.trim()}>
    ${title || actions
      ? html`<header class="card-head">
          <div class="card-title">
            ${icon ? html`<span class="card-icon"><${Icon} name=${icon} size=${18} /></span>` : null}
            <div>
              <h3>${title}</h3>
              ${subtitle ? html`<p class="card-sub">${subtitle}</p>` : null}
            </div>
          </div>
          ${actions ? html`<div class="card-actions">${actions}</div>` : null}
        </header>`
      : null}
    <div class="card-body">${children}</div>
  </section>`;
}

/** Small status pill. */
export function Badge({ tone = "neutral", icon, children, title }) {
  return html`<span class=${`badge ${tone}`} title=${title}>
    ${icon ? html`<${Icon} name=${icon} size=${13} />` : null}${children}
  </span>`;
}

/** Big number + caption tile used in diff/dry-run summaries. */
export function Stat({ value, label, tone = "" }) {
  return html`<div class=${`stat ${tone}`.trim()}>
    <b>${value}</b>
    <span>${label}</span>
  </div>`;
}

/** Stat row helper. */
export function StatRow({ children }) {
  return html`<div class="stats">${children}</div>`;
}

/** Labelled form field. */
export function Field({ label, hint, children, className = "", id }) {
  return html`<label class=${`field ${className}`.trim()} for=${id}>
    ${label ? html`<span class="field-label">${label}</span>` : null}
    ${children}
    ${hint ? html`<span class="field-hint">${hint}</span>` : null}
  </label>`;
}

/** Checkbox styled as a switch. */
export function Switch({ checked, onChange, label, hint, danger = false }) {
  return html`<label class=${`switch-row ${danger ? "danger" : ""}`.trim()}>
    <input type="checkbox" checked=${Boolean(checked)} onChange=${(ev) => onChange?.(ev.target.checked)} />
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
    <span class="switch-text">
      <span class="switch-label">${label}</span>
      ${hint ? html`<span class="field-hint">${hint}</span>` : null}
    </span>
  </label>`;
}

/** Indeterminate-progress spinner. */
export function Spinner({ size = 20 }) {
  return html`<span class="spinner" style=${`width:${size}px;height:${size}px`} aria-hidden="true" />`;
}

/** Shimmering placeholder used instead of “Loading…”. */
export function Skeleton({ lines = 3, className = "" }) {
  return html`<div class=${`skeleton ${className}`.trim()} aria-hidden="true">
    ${Array.from({ length: lines }, (_, index) => html`<span key=${index} class="skeleton-line" style=${`width:${70 - index * 12}%`} />`)}
  </div>`;
}

/** Friendly empty / first-run state. */
export function EmptyState({ icon = "layers", title, body, actions }) {
  return html`<div class="empty">
    <div class="empty-art"><${Icon} name=${icon} size=${44} /></div>
    <h2>${title}</h2>
    ${body ? html`<p class="empty-body">${body}</p>` : null}
    ${actions ? html`<div class="row center">${actions}</div>` : null}
  </div>`;
}

/** Inline banner (info / success / warning / error). */
export function Banner({ tone = "info", icon, title, children, actions }) {
  return html`<div class=${`banner ${tone}`} role=${tone === "error" ? "alert" : "status"}>
    ${icon ? html`<span class="banner-icon"><${Icon} name=${icon} size=${18} /></span>` : null}
    <div class="banner-text">
      ${title ? html`<strong>${title}</strong>` : null}
      ${children}
    </div>
    ${actions ? html`<div class="banner-actions">${actions}</div>` : null}
  </div>`;
}

/* -------------------------------------------------------------------- modal */

/** Accessible modal dialog: Esc to close, backdrop click, focus on open. */
export function Modal({ title, subtitle, onClose, children, footer, size = "md", tone = "" }) {
  const panel = useRef(null);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    const focusTarget = panel.current?.querySelector("[data-autofocus]") || panel.current;
    focusTarget?.focus?.();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return html`<div class="overlay" onClick=${(ev) => ev.target === ev.currentTarget && onClose?.()}>
    <div
      class=${`dialog ${size} ${tone}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label=${title || "Dialog"}
      tabindex="-1"
      ref=${panel}
    >
      ${title
        ? html`<header class="dialog-head">
            <div>
              <h2>${title}</h2>
              ${subtitle ? html`<p class="card-sub">${subtitle}</p>` : null}
            </div>
            ${onClose ? html`<${IconButton} name="close" label="Close" onClick=${onClose} />` : null}
          </header>`
        : null}
      <div class="dialog-body">${children}</div>
      ${footer ? html`<footer class="dialog-foot">${footer}</footer>` : null}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------- toasts */

/** Toast stack (aria-live so screen readers announce results). */
export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return html`<div class="toasts" aria-live="polite" aria-atomic="false">
    ${toasts.map(
      (item) => html`<div key=${item.id} class=${`toast ${item.tone}`}>
        <${Icon} name=${item.tone === "error" ? "warning" : item.tone === "success" ? "check" : "info"} size=${16} />
        <span class="toast-text">${item.message}</span>
        <button type="button" class="toast-close" aria-label="Dismiss" onClick=${() => onDismiss(item.id)}>
          <${Icon} name="close" size=${14} />
        </button>
      </div>`
    )}
  </div>`;
}

/* ------------------------------------------------------------ busy overlay */

/** Full-screen overlay shown while a long job runs, with live progress. */
export function BusyOverlay({ job, updating: isUpdating = false, version: nextVersion }) {
  if (!job && !isUpdating) return null;
  const total = Number(job?.total) || 0;
  const current = Number(job?.current) || 0;
  const ratio = total > 0 ? Math.max(2, Math.min(100, Math.round((current / total) * 100))) : null;
  return html`<div class="busy" role="status" aria-live="polite">
    <div class="busy-card">
      ${isUpdating ? html`<${Icon} name="sparkles" size=${26} />` : html`<${Spinner} size=${30} />`}
      <p class="busy-title">
        ${isUpdating ? `Updating GitHub Sync${nextVersion ? ` to v${nextVersion}` : ""}…` : job.label}
      </p>
      ${job?.message && job.message !== job.label ? html`<p class="busy-message">${job.message}</p>` : null}
      ${isUpdating
        ? html`<p class="busy-message">Home Assistant installs the new version and restarts this app. The panel reconnects on its own — if it stalls, close and reopen GitHub Sync.</p>`
        : null}
      ${ratio !== null && !isUpdating
        ? html`<div class="progress"><span class="progress-bar" style=${`width:${ratio}%`} /><span class="progress-label">${current} / ${total}</span></div>`
        : html`<div class="progress subtle"><span class="progress-bar indeterminate" /></div>`}
    </div>
  </div>`;
}

/** Fragment re-export so views can group children. */
export { Fragment };
