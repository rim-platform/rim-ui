// The frame shell: the fixed page every web plugin frame and panel frame loads.
// It announces itself to its parent with `rim.frame.hello`, and the host posts
// one `rim.frame.init` message with the plugin's verified files;
// the shell narrows the page's content security policy to the plugin's granted
// origins before any plugin byte runs, then either imports the plugin's entry
// module (a plugin frame, which also gets the host's MessagePort) or renders a
// panel (a panel frame).
(function () {
  "use strict";

  var ORIGIN = /^(https|wss):\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$/;
  var SCHEME = /^[a-z][a-z0-9+.-]*:/i;
  var JS_TYPES = ["", "text/javascript", "application/javascript", "module"];
  var MEDIA_TYPES = {
    html: "text/html",
    js: "text/javascript",
    mjs: "text/javascript",
    css: "text/css",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    wasm: "application/wasm",
    txt: "text/plain",
  };
  var started = false;

  function fail(message) {
    window.parent.postMessage(
      { type: "rim.frame.error", v: 1, message: String(message).slice(0, 500) },
      "*",
    );
  }

  /** Append the per-plugin policy; policies intersect, so it can only narrow. */
  function applyPolicy(policy) {
    var origins = policy && Array.isArray(policy.origins) ? policy.origins : [];
    for (var i = 0; i < origins.length; i++) {
      if (typeof origins[i] !== "string" || !ORIGIN.test(origins[i])) {
        throw new Error("the host sent an invalid origin");
      }
    }
    var listed = origins.join(" ");
    var meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute(
      "content",
      origins.length > 0
        ? "connect-src " + listed + "; img-src 'self' blob: data: " + listed
        : "connect-src 'none'; img-src 'self' blob: data:",
    );
    meta.setAttribute("data-rim-shell", "");
    document.head.appendChild(meta);
  }

  function blobUrl(file) {
    return URL.createObjectURL(new Blob([file.bytes], { type: file.type || mediaType(file.path) }));
  }

  function mediaType(path) {
    var dot = path.lastIndexOf(".");
    return MEDIA_TYPES[path.slice(dot + 1).toLowerCase()] || "application/octet-stream";
  }

  function lockGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
      value: value,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  function startPlugin(init, port) {
    if (!port) throw new Error("the host sent no port");
    var entrypoint = JSON.parse(init.manifest).entrypoint;
    var entry = (init.files || []).filter(function (f) {
      return f.path === entrypoint;
    })[0];
    if (!entry) throw new Error("the entry module " + entrypoint + " is missing");
    lockGlobal("rimPluginPort", port);
    lockGlobal("rimPluginManifest", init.manifest);
    var url = blobUrl({ path: entry.path, type: "text/javascript", bytes: entry.bytes });
    import(url).catch(function (error) {
      fail(error && error.message ? error.message : error);
    });
  }

  /** The panel file a relative URL in `index.html` names, or null. */
  function panelFile(files, url) {
    if (!url || SCHEME.test(url) || url.indexOf("//") === 0 || url.charAt(0) === "#") return null;
    var path = url.split(/[?#]/)[0];
    var parts = [];
    var segments = path.split("/");
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (parts.length === 0) return undefined;
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    return files[parts.join("/")];
  }

  function isRelative(url) {
    return !!url && !SCHEME.test(url) && url.indexOf("//") !== 0 && url.charAt(0) !== "#";
  }

  /** Point a URL attribute at the panel file it names, or drop it if it names none. */
  function rewrite(element, attribute, files) {
    var url = element.getAttribute(attribute);
    if (!isRelative(url)) return;
    var file = panelFile(files, url);
    if (file) element.setAttribute(attribute, blobUrl(file));
    else element.removeAttribute(attribute);
  }

  function isScript(element) {
    var type = (element.getAttribute("type") || "").trim().toLowerCase();
    return JS_TYPES.indexOf(type) !== -1;
  }

  function prepare(doc, files) {
    doc.querySelectorAll("base, meta[http-equiv]").forEach(function (el) {
      var equiv = (el.getAttribute("http-equiv") || "").toLowerCase();
      if (el.tagName === "BASE" || equiv === "refresh") el.remove();
    });
    doc.querySelectorAll("script[src]").forEach(function (el) {
      if (isScript(el)) rewrite(el, "src", files);
    });
    doc.querySelectorAll("link").forEach(function (el) {
      var rel = " " + (el.getAttribute("rel") || "").toLowerCase() + " ";
      if (rel.indexOf(" stylesheet ") !== -1 || rel.indexOf(" icon ") !== -1) {
        rewrite(el, "href", files);
      }
    });
    doc.querySelectorAll("img, source, audio, video").forEach(function (el) {
      rewrite(el, "src", files);
      if (el.tagName === "VIDEO") rewrite(el, "poster", files);
      var srcset = el.getAttribute("srcset");
      if (
        srcset &&
        srcset.split(",").some(function (c) {
          return isRelative(c.trim().split(/\s+/)[0]);
        })
      ) {
        el.removeAttribute("srcset");
      }
    });
    doc.querySelectorAll("script:not([src])").forEach(function (el) {
      if (!isScript(el)) return;
      el.setAttribute(
        "src",
        blobUrl({ path: "inline.js", type: "text/javascript", bytes: el.textContent || "" }),
      );
      el.textContent = "";
    });
  }

  /**
   * Move `from`'s children into `to`. Each script is swapped for a placeholder
   * first and then for a fresh script, so it runs once, in document order.
   */
  function adopt(from, to, scripts) {
    var originals = [];
    from.querySelectorAll("script").forEach(function (old) {
      if (!isScript(old)) return;
      var placeholder = from.ownerDocument.createElement("template");
      placeholder.setAttribute("data-rim-script", String(originals.length));
      old.parentNode.replaceChild(placeholder, old);
      originals.push(old);
    });
    Array.prototype.slice.call(from.childNodes).forEach(function (node) {
      to.appendChild(document.importNode(node, true));
    });
    to.querySelectorAll("template[data-rim-script]").forEach(function (placeholder) {
      var old = originals[Number(placeholder.getAttribute("data-rim-script"))];
      var script = document.createElement("script");
      Array.prototype.slice.call(old.attributes).forEach(function (attr) {
        script.setAttribute(attr.name, attr.value);
      });
      script.async = false;
      placeholder.parentNode.replaceChild(script, placeholder);
      scripts.push(script);
    });
  }

  function copyAttributes(from, to) {
    Array.prototype.slice.call(from.attributes).forEach(function (attr) {
      to.setAttribute(attr.name, attr.value);
    });
  }

  function renderPanel(init) {
    var files = {};
    (init.files || []).forEach(function (file) {
      files[file.path] = file;
    });
    var index = files["index.html"];
    if (!index) throw new Error("the panel has no index.html");
    var html = new TextDecoder().decode(index.bytes);
    var doc = new DOMParser().parseFromString(html, "text/html");
    prepare(doc, files);

    Array.prototype.slice.call(document.head.childNodes).forEach(function (node) {
      if (!(node.nodeType === 1 && node.hasAttribute("data-rim-shell"))) node.remove();
    });
    document.body.textContent = "";
    copyAttributes(doc.documentElement, document.documentElement);
    copyAttributes(doc.body, document.body);

    var scripts = [];
    adopt(doc.head, document.head, scripts);
    adopt(doc.body, document.body, scripts);

    var waiting = scripts.length;
    function settled() {
      waiting -= 1;
      if (waiting === 0) loaded();
    }
    scripts.forEach(function (script) {
      script.addEventListener("load", settled);
      script.addEventListener("error", settled);
    });
    if (waiting === 0) loaded();
  }

  function loaded() {
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    window.dispatchEvent(new Event("load"));
    window.parent.postMessage({ type: "rim.frame.ready", v: 1 }, "*");
  }

  window.addEventListener("message", function (event) {
    if (started || event.source !== window.parent) return;
    var init = event.data;
    if (!init || init.type !== "rim.frame.init" || init.v !== 1) return;
    started = true;
    try {
      applyPolicy(init.policy);
      if (init.kind === "plugin") startPlugin(init, event.ports && event.ports[0]);
      else if (init.kind === "panel") renderPanel(init);
      else throw new Error("unknown frame kind");
    } catch (error) {
      fail(error && error.message ? error.message : error);
    }
  });

  // Sent before any plugin byte runs, so it can only come from the shell.
  window.parent.postMessage({ type: "rim.frame.hello", v: 1 }, "*");
})();
