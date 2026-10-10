const COPIED_MS = 1500;

/** The language of a rendered code element, read from its `language-*` class. */
function languageOf(code: Element): string | null {
  for (const name of code.classList) {
    if (name.startsWith("language-")) return name.slice("language-".length);
  }
  return null;
}

/**
 * Gives every code block under `root` a header with its language and a copy button. The
 * header is built here, outside the sanitised HTML, so message content cannot forge it.
 */
export function addCodeBlockToolbars(root: HTMLElement): void {
  for (const pre of root.querySelectorAll("pre")) {
    const code = pre.querySelector(":scope > code");
    if (!code || pre.querySelector(":scope > .rim-code-toolbar")) continue;
    const language = languageOf(code);

    const label = document.createElement("span");
    label.className = "rim-code-language";
    label.textContent = language ?? "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rim-code-copy";
    button.dataset.codeCopy = "";
    button.setAttribute("aria-label", language ? `Copy ${language} code` : "Copy code");
    button.textContent = "Copy";

    const toolbar = document.createElement("div");
    toolbar.className = "rim-code-toolbar";
    toolbar.append(label, button);
    pre.prepend(toolbar);
  }
}

/** Copies the code of the block `button` belongs to and says so on the button for a moment. */
export async function copyCodeBlock(button: HTMLButtonElement): Promise<void> {
  const code = button.closest("pre")?.querySelector(":scope > code")?.textContent ?? "";
  await navigator.clipboard.writeText(code);
  const label = button.getAttribute("aria-label");
  button.textContent = "Copied";
  button.setAttribute("aria-label", "Copied");
  setTimeout(() => {
    button.textContent = "Copy";
    if (label) button.setAttribute("aria-label", label);
  }, COPIED_MS);
}
