/**
 * Minimal DOM used by the frontend tests.
 *
 * The panel renders Preact into a real DOM in the browser; the CI job runs in
 * plain Node, so this stub implements just enough of the DOM (elements, text
 * nodes, attributes, listeners, `innerHTML` serialisation) for `preact.render`
 * and for tests to inspect or click the rendered tree.
 *
 * Test-only helper — never shipped in the app image.
 */

const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link", "source", "path"]);

function escapeText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

class FakeStyle {
  constructor() {
    this._props = {};
    this._css = "";
  }
  setProperty(name, value) {
    this._props[name] = value;
  }
  getPropertyValue(name) {
    return this._props[name] || "";
  }
  removeProperty(name) {
    delete this._props[name];
  }
  set cssText(value) {
    this._css = String(value || "");
  }
  get cssText() {
    return this._css;
  }
}

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = {};
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    child.parentNode = this;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index !== -1) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this._listeners[type] || [];
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
  }
  dispatchEvent(event) {
    const payload = { type: event.type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event };
    // Listeners run with `this` bound to the element, exactly like the DOM —
    // Preact's event proxy reads `this.l` (its listener registry).
    for (const handler of this._listeners[event.type] || []) handler.call(this, payload);
    return true;
  }
  /** Click helper used by the tests. */
  click() {
    this.dispatchEvent({ type: "click" });
  }
  focus() {
    this._focused = true;
  }
  querySelector() {
    return null;
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent ?? "").join("");
  }
  set textContent(value) {
    this.childNodes = [];
    if (value !== "" && value !== null && value !== undefined) this.appendChild(new FakeText(String(value)));
  }
  get innerHTML() {
    return this.childNodes.map(serialize).join("");
  }
  set innerHTML(value) {
    this.childNodes = [];
    this._raw = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this.style = new FakeStyle();
    this.attributes = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this._raw = undefined;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "class") this.className = "";
    if (name === "id") this.id = "";
  }
  get classList() {
    const self = this;
    const list = () => (self.className || "").split(/\s+/).filter(Boolean);
    return {
      contains: (name) => list().includes(name),
      add: (name) => {
        if (!list().includes(name)) self.className = [...list(), name].join(" ");
      },
      remove: (name) => {
        self.className = list().filter((item) => item !== name).join(" ");
      },
    };
  }
  /** Depth-first search for a selector subset: `.class`, `#id` or tag name. */
  querySelectorAll(selector) {
    const matches = [];
    const test = (node) => {
      if (node.nodeType !== 1) return false;
      if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
      if (selector.startsWith("#")) return node.id === selector.slice(1);
      return node.localName === selector;
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (test(child)) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

// Real DOM elements own `onclick`, `oninput`, … properties. Preact checks
// `'onclick' in element` to decide whether to lower-case the event name, so the
// stub must expose them too — otherwise listeners land on `Click` and never fire.
for (const type of [
  "click",
  "input",
  "change",
  "submit",
  "keydown",
  "keyup",
  "focus",
  "blur",
  "pointerdown",
  "pointerup",
  "touchstart",
  "scroll",
]) {
  Object.defineProperty(FakeElement.prototype, `on${type}`, { value: null, writable: true, configurable: true });
}

class FakeText extends FakeNode {
  constructor(data) {
    super(3);
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
  set textContent(value) {
    this.data = String(value);
  }
}

/** Serialise a node tree into an HTML string (attributes escaped). */
function serialize(node) {
  if (!node) return "";
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  const attrs = Object.entries(node.attributes || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
  const inner = node._raw !== undefined ? node._raw : node.childNodes.map(serialize).join("");
  if (VOID_TAGS.has(node.localName) && !inner) return `<${node.localName}${attrs}>`;
  return `<${node.localName}${attrs}>${inner}</${node.localName}>`;
}

/** Create a fake `document`, its `window` and a mount point. */
function createDom() {
  const elements = [];
  const document = {
    body: new FakeElement("body"),
    documentElement: new FakeElement("html"),
    visibilityState: "visible",
    _listeners: {},
    createElement(tag) {
      const element = new FakeElement(tag);
      elements.push(element);
      return element;
    },
    createElementNS(_ns, tag) {
      return document.createElement(tag);
    },
    createTextNode(text) {
      return new FakeText(text);
    },
    createComment(text) {
      const comment = new FakeNode(8);
      comment.data = text;
      return comment;
    },
    getElementById(id) {
      return elements.find((element) => element.id === id) || null;
    },
    querySelector() {
      return null;
    },
    addEventListener(type, handler) {
      (document._listeners[type] = document._listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const list = document._listeners[type] || [];
      const index = list.indexOf(handler);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent(event) {
      for (const handler of document._listeners[event.type] || []) handler({ ...event, type: event.type });
      return true;
    },
  };
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  return { document, root, serialize };
}

/** Install a fake browser global set on `globalThis` (Node 22 safe). */
function installDom(document) {
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("document", document);
  define("window", { document, location: { reload() {} }, addEventListener() {} });
  define("location", { href: "https://example.test/", reload() {} });
  define("localStorage", makeStorage());
  define("navigator", { clipboard: { writeText: async () => {} }, userAgent: "node" });
  return document;
}

/** In-memory `localStorage` stand-in. */
function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    _store: store,
  };
}

module.exports = { createDom, installDom, makeStorage, serialize, FakeElement, FakeText };
