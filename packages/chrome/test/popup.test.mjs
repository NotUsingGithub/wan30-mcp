import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { LINKS, REQUIREMENTS } from "../setup.js";
import { mount } from "../popup.js";

function createDocument() {
  function make(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      id: "",
      children: [],
      attrs: {},
      listeners: {},
      parent: null,
      value: "",
      _text: "",
      disabled: false,
      type: "",
      href: "",
      target: "",
      rel: "",
      classList: {
        classes: new Set(),
        add(name) {
          this.classes.add(name);
        },
        contains(name) {
          return this.classes.has(name);
        },
      },
      append(...kids) {
        for (const kid of kids) {
          this.children.push(kid);
          kid.parent = this;
        }
      },
      setAttribute(name, value) {
        this.attrs[name] = String(value);
        if (name === "id") this.id = String(value);
      },
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((child) => child !== this);
      },
      focus() {},
      select() {},
      get textContent() {
        if (this.children.length === 0) return this._text;
        return this.children.map((child) => child.textContent).join("");
      },
      set textContent(value) {
        this._text = String(value);
        this.children = [];
      },
      set className(value) {
        this.classList.classes.clear();
        for (const part of String(value).split(/\s+/)) if (part) this.classList.classes.add(part);
      },
      async click() {
        const event = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        for (const fn of this.listeners.click || []) await fn(event);
        return event;
      },
      dispatch(type) {
        const event = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        for (const fn of this.listeners[type] || []) fn(event);
        return event;
      },
    };
    return el;
  }

  const doc = {
    location: { search: "" },
    createElement: make,
    execCommand() {
      return doc.copyCommandOk;
    },
    copyCommandOk: true,
    getElementById(id) {
      let found = null;
      walk(doc.body, (node) => {
        if (node.id === id) found = node;
      });
      return found;
    },
  };
  doc.body = make("body");
  const form = make("form");
  form.id = "setup-form";
  const platform = make("select");
  platform.id = "platform";
  const origin = make("input");
  origin.id = "origin";
  origin.value = "https://wan30.video";
  form.append(platform, origin);
  doc.body.append(form);
  for (const id of ["origin-message", "platform-message", "copy-status"]) {
    const node = make("p");
    node.id = id;
    doc.body.append(node);
  }
  for (const [tag, id] of [
    ["ul", "requirements"],
    ["div", "snippet-root"],
    ["ul", "doc-links"],
  ]) {
    const node = make(tag);
    node.id = id;
    doc.body.append(node);
  }
  return doc;
}

function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of [...node.children]) walk(child, visit);
}

function buttons(doc) {
  const found = [];
  walk(doc.body, (node) => {
    if (node.tagName === "BUTTON") found.push(node);
  });
  return found;
}

function button(doc, id) {
  return buttons(doc).find((node) => node.attrs["data-snippet"] === id);
}

function anchors(doc) {
  const found = [];
  walk(doc.body, (node) => {
    if (node.tagName === "A") found.push(node);
  });
  return found;
}

test("copy and navigation happen only after a click", async () => {
  const doc = createDocument();
  const copied = [];
  const opened = [];
  doc.getElementById("platform").value = "linux";
  mount(doc, {
    clipboard: {
      writeText: async (text) => {
        copied.push(text);
      },
    },
    open: (url) => opened.push(url),
  });
  assert.deepEqual(copied, []);
  assert.deepEqual(opened, []);
  assert.deepEqual(
    [...doc.getElementById("requirements").children].map((item) => item.textContent),
    REQUIREMENTS
  );
  await button(doc, "mcp").click();
  assert.equal(copied.length, 1);
  assert.equal(JSON.parse(copied[0]).mcpServers.wan30.command, "npx");
  assert.equal(doc.getElementById("copy-status").textContent, "Copied.");
  const link = anchors(doc).find((anchor) => anchor.href === "https://wan30.video/mcp/");
  const event = await link.click();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(opened, ["https://wan30.video/mcp/"]);
  assert.deepEqual(
    anchors(doc).map((anchor) => anchor.href),
    LINKS.map((link) => link.href)
  );
  for (const anchor of anchors(doc)) {
    assert.equal(anchor.target, "_blank");
    assert.equal(anchor.rel, "noopener noreferrer");
  }
});

test("invalid input and an unconfirmed platform do not copy a command", async () => {
  const doc = createDocument();
  const copied = [];
  mount(doc, {
    clipboard: {
      writeText: async (text) => copied.push(text),
    },
  });
  assert.equal(button(doc, "create").disabled, true);
  await button(doc, "create").click();
  doc.getElementById("origin").value = "https://wan30.video/pricing/";
  doc.getElementById("origin").dispatch("input");
  assert.equal(doc.getElementById("origin").attrs["aria-invalid"], "true");
  assert.equal(button(doc, "mcp").disabled, true);
  await button(doc, "mcp").click();
  const submit = doc.getElementById("setup-form").dispatch("submit");
  assert.equal(submit.defaultPrevented, true);
  assert.deepEqual(copied, []);
});

test("Linux selection copies the file credential-store command and a failed clipboard is visible", async () => {
  const doc = createDocument();
  doc.getElementById("platform").value = "linux";
  mount(doc, {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  doc.copyCommandOk = false;
  await button(doc, "login").click();
  assert.equal(
    doc.getElementById("copy-status").textContent,
    "Could not copy. Select the text and copy it yourself."
  );
  doc.copyCommandOk = true;
  await button(doc, "login").click();
  assert.equal(doc.getElementById("copy-status").textContent, "Copied.");
  const preview = button(doc, "login").parent.children.find((node) => node.tagName === "PRE");
  assert.equal(preview.textContent, "wan30 auth login --credential-store file\n");
});

test("the popup file has no remote script or inline handler", () => {
  const html = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="popup\.js"><\/script>/);
  assert.equal(html.includes("onclick="), false);
  assert.equal(/<script[^>]+src="https?:/.test(html), false);
  const css = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
  assert.equal(css.includes("@import"), false);
  const runtime = ["popup.js", "setup.js", "popup.html", "popup.css"]
    .map((name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8"))
    .join("\n");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "eval(", "new Function", "child_process", "localStorage", "chrome.storage"]) {
    assert.equal(runtime.includes(forbidden), false, forbidden);
  }
});
