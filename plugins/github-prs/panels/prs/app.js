// The Pull requests panel. The plugin frame sends its state through the host
// (panel.state_update); the panel runs the plugin's commands through the host
// bridge (rim.command.execute). It renders everything as text and has no links,
// since following one would navigate the panel's frame, which closes it.
(function () {
  "use strict";

  var PLUGIN_ID = "chat.rim.github-prs";
  var state = null;
  var nextRequest = 1;
  var pending = {};

  var $ = function (id) {
    return document.getElementById(id);
  };
  var els = {
    repo: $("repo"),
    add: $("add"),
    refresh: $("refresh"),
    notice: $("notice"),
    list: $("list"),
    empty: $("empty"),
  };

  function send(message) {
    window.parent.postMessage(message, "*");
  }

  /** Run one of this plugin's commands; `onResult` gets the host's answer. */
  function run(verb, args, onResult) {
    var requestId = "prs-" + nextRequest++;
    if (onResult) pending[requestId] = onResult;
    send({
      type: "rim.command.execute",
      commandId: "plugin." + PLUGIN_ID + "." + verb,
      args: args || {},
      requestId: requestId,
    });
  }

  function showNotice(text) {
    els.notice.hidden = !text;
    els.notice.textContent = text || "";
  }

  function age(iso) {
    var created = Date.parse(iso);
    if (!created) return "";
    var minutes = Math.max(0, Math.round((Date.now() - created) / 60000));
    if (minutes < 60) return minutes + "m";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + "h";
    return Math.round(hours / 24) + "d";
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderPull(pull) {
    var item = element("li");
    if (pull.avatarUrl) {
      var avatar = element("img");
      avatar.src = pull.avatarUrl;
      avatar.alt = "";
      item.appendChild(avatar);
    }
    var body = element("div");
    var title = element("div", "title", "#" + pull.number + " " + pull.title);
    title.title = pull.url;
    if (pull.draft) title.appendChild(element("span", "draft", "draft"));
    body.appendChild(title);
    body.appendChild(element("div", "meta", pull.author + " · " + age(pull.createdAt)));
    item.appendChild(body);
    return item;
  }

  function renderRepo(repo) {
    var section = element("section");
    var heading = element("h2");
    heading.appendChild(element("span", "name", repo.repo));
    heading.appendChild(element("span", "", String(repo.pulls.length)));
    var remove = element("button", "", "×");
    remove.type = "button";
    remove.title = "Remove " + repo.repo;
    remove.setAttribute("aria-label", "Remove " + repo.repo);
    remove.addEventListener("click", function () {
      run("remove_repo", { repo: repo.repo }, report);
    });
    heading.appendChild(remove);
    section.appendChild(heading);
    if (repo.error) section.appendChild(element("div", "error", repo.error));
    var list = element("ul");
    repo.pulls.forEach(function (pull) {
      list.appendChild(renderPull(pull));
    });
    section.appendChild(list);
    return section;
  }

  function render() {
    els.list.textContent = "";
    if (!state) return;
    var full = state.repos.length >= state.maxRepos;
    els.repo.disabled = !state.signedIn || full;
    els.add.disabled = !state.signedIn || full;
    els.refresh.disabled = state.loading;
    els.refresh.textContent = state.loading ? "Loading…" : "Refresh";
    showNotice(state.notice);
    state.repos.forEach(function (repo) {
      els.list.appendChild(renderRepo(repo));
    });
    els.empty.hidden = state.repos.length > 0;
    els.empty.textContent = state.signedIn
      ? "Add a public repository as owner/name to see its open pull requests."
      : "Sign in to keep a list of repositories.";
  }

  /** Show a failed command's message; a successful one shows in the state. */
  function report(result) {
    if (result && !result.ok && !result.cancelled) showNotice(result.message);
  }

  function addRepo() {
    var repo = els.repo.value.trim();
    if (!repo) return;
    run("add_repo", { repo: repo }, function (result) {
      if (result.ok) els.repo.value = "";
      report(result);
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || typeof message.type !== "string") return;
    switch (message.type) {
      case "theme.changed":
        Object.keys(message.variables || {}).forEach(function (name) {
          var value = message.variables[name];
          if (value) document.documentElement.style.setProperty(name, value);
        });
        break;
      case "panel.state_update":
        state = message.state;
        if (state === null) {
          els.empty.hidden = false;
          els.empty.textContent = "The plugin stopped.";
          els.list.textContent = "";
          return;
        }
        render();
        break;
      case "rim.command.result": {
        var done = pending[message.requestId];
        delete pending[message.requestId];
        if (done) done(message);
        break;
      }
    }
  });

  els.add.addEventListener("click", addRepo);
  els.repo.addEventListener("keydown", function (event) {
    if (event.key === "Enter") addRepo();
  });
  els.refresh.addEventListener("click", function () {
    run("refresh", {}, report);
  });
  document.addEventListener("keydown", function (event) {
    if (event.target === els.repo) return;
    if (event.key === "r") run("refresh", {}, report);
    if (event.key === "/") {
      event.preventDefault();
      els.repo.focus();
    }
  });
})();
