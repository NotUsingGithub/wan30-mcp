import { buildSetup, copyText } from "./setup.js";

export function mount(doc, deps = {}) {
  const platform = doc.getElementById("platform");
  const origin = doc.getElementById("origin");
  const originMessage = doc.getElementById("origin-message");
  const platformMessage = doc.getElementById("platform-message");
  const copyStatus = doc.getElementById("copy-status");
  const snippetRoot = doc.getElementById("snippet-root");
  const requirements = doc.getElementById("requirements");
  const docLinks = doc.getElementById("doc-links");
  const form = doc.getElementById("setup-form");
  const clipboard = deps.clipboard || globalThis.navigator?.clipboard;

  form.addEventListener("submit", (event) => event.preventDefault());
  if (new URLSearchParams(doc.location?.search || "").get("listing") === "1")
    doc.body.classList.add("listing");

  function paint() {
    const state = buildSetup({ origin: origin.value, platform: platform.value });
    origin.setAttribute("aria-invalid", state.origin.ok ? "false" : "true");
    originMessage.textContent = state.origin.message;
    platformMessage.textContent = state.platformMessage;
    requirements.textContent = "";
    for (const line of state.requirements) {
      const item = doc.createElement("li");
      item.textContent = line;
      requirements.append(item);
    }
    snippetRoot.textContent = "";
    for (const group of state.groups) {
      const section = doc.createElement("section");
      section.className = group.id === "paid" ? "group paid" : "group";
      section.setAttribute("data-group", group.id);
      const heading = doc.createElement("h2");
      heading.textContent = group.title;
      section.append(heading);
      if (group.note) {
        const note = doc.createElement("p");
        note.className = "note";
        note.textContent = group.note;
        section.append(note);
      }
      for (const item of group.snippets) {
        const block = doc.createElement("div");
        block.className = "snippet";
        const title = doc.createElement("h3");
        title.textContent = item.title;
        const preview = doc.createElement("pre");
        preview.textContent = item.text;
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = item.copyLabel;
        button.disabled = !item.copyable;
        button.setAttribute("data-snippet", item.id);
        button.addEventListener("click", async () => {
          if (button.disabled) return;
          try {
            await copyText(item.text, { clipboard, document: doc });
            copyStatus.textContent = "Copied.";
          } catch {
            copyStatus.textContent = "Could not copy. Select the text and copy it yourself.";
          }
        });
        block.append(title, preview, button);
        section.append(block);
      }
      snippetRoot.append(section);
    }
    docLinks.textContent = "";
    for (const link of state.links) {
      const item = doc.createElement("li");
      const anchor = doc.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.addEventListener("click", (event) => {
        if (!deps.open) return;
        event.preventDefault();
        deps.open(link.href);
      });
      item.append(anchor);
      docLinks.append(item);
    }
  }

  origin.addEventListener("input", paint);
  platform.addEventListener("change", paint);
  paint();
}

if (typeof document !== "undefined" && document.getElementById?.("snippet-root")) mount(document);
