(function () {
    "use strict";

    // Read from the raw endpoint rather than from this site: the uptime workflow
    // force-pushes the file to an orphan branch, so publishing 48 times a day never
    // touches the branch Pages builds from. raw.githubusercontent.com serves it with
    // Access-Control-Allow-Origin: * and caches it for about five minutes.
    var STATUS_URL = "https://raw.githubusercontent.com/BlueVolt1/app/status-data/status.json";

    // A monitor that stopped reporting must never render as green - but this threshold
    // has to clear the monitor's own interval or the page calls itself stale forever.
    // The workflow runs at :07 and :37, so a reading is routinely 30 minutes old before
    // the next one lands, and the raw CDN can hold a stale copy ~5 minutes on top. 75
    // minutes is two missed runs plus that cache, so a single dropped cron - which
    // GitHub does regularly - reads as normal, and two in a row reads as broken.
    var STALE_MS = 75 * 60 * 1000;

    // 90 days is the target, but a bar has to stay wide enough to be a bar. On a phone
    // the row is ~310px wide, which at 3px plus a 2px gap holds roughly 60 days - so
    // the window is trimmed to what fits rather than letting the row overflow the panel.
    var MAX_DAYS = 90;
    var MIN_DAYS = 14;
    var BAR_MIN = 3;
    var BAR_GAP = 2;

    var el = function (id) { return document.getElementById(id); };
    var t = SiteLanguage.text;

    function relative(value, unit) {
        return new Intl.RelativeTimeFormat(SiteLanguage.code(), { numeric: "auto" }).format(value, unit);
    }

    function text(tag, className, content) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (content !== undefined) { node.textContent = content; }
        return node;
    }

    // ---------------------------------------------------------------------------
    // Public status
    // ---------------------------------------------------------------------------

    function renderBanner(state, sub) {
        var banner = el("banner");
        banner.className = "panel " + state.kind;
        el("banner-headline").textContent = state.headline;
        el("banner-sub").textContent = sub || "";
    }

    function dayClass(bucket) {
        if (!bucket) { return ""; }
        var total = bucket.ok + bucket.fail;
        if (total === 0) { return ""; }
        if (bucket.fail === 0) { return "ok"; }
        if (bucket.ok === 0) { return "down"; }
        return "partial";
    }

    // Measured rather than guessed from innerWidth: the panel's own padding is a clamp()
    // and the row also has to survive a desktop window being dragged narrow.
    function daysThatFit() {
        var container = el("services");
        var probe = text("div", "service");
        probe.style.visibility = "hidden";
        container.appendChild(probe);

        var style = window.getComputedStyle(probe);
        var inner = probe.clientWidth
            - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        container.removeChild(probe);

        if (!isFinite(inner) || inner <= 0) { return MAX_DAYS; }

        var fits = Math.floor((inner + BAR_GAP) / (BAR_MIN + BAR_GAP));
        return Math.max(MIN_DAYS, Math.min(MAX_DAYS, fits));
    }

    function renderService(service, history, stale, days) {
        var row = text("div", "service");

        var head = text("div", "service-head");
        head.appendChild(text("span", "name", serviceName(service)));

        var stateClass = stale ? "unknown" : service.status;
        var stateLabel = t(stale ? "unknown" : (service.status === "ok" ? "operational" : "down"));
        head.appendChild(text("span", "state " + stateClass, stateLabel));
        row.appendChild(head);

        var byDate = {};
        (history || []).forEach(function (d) { byDate[d.date] = d; });

        // Right-align the history against today so the newest bar is always last, and
        // pad the left with blanks when there is less history than the window shows.
        // Uptime is summed over the same window, so the number always describes the
        // bars next to it even when the window has been trimmed for a narrow screen.
        var bars = text("div", "bars");
        var today = new Date();
        var ok = 0;
        var total = 0;

        for (var i = days - 1; i >= 0; i--) {
            var day = new Date(Date.UTC(
                today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
            var key = day.toISOString().slice(0, 10);
            var bucket = byDate[key];
            var bar = text("div", "bar " + dayClass(bucket));
            var label = bucket
                ? t("barUp", { date: key, percent: Math.round(bucket.ok * 100 / (bucket.ok + bucket.fail)) })
                : t("barNoData", { date: key });
            bar.title = label;
            bar.setAttribute("data-label", label);
            if (bucket) {
                ok += bucket.ok;
                total += bucket.ok + bucket.fail;
            }
            bars.appendChild(bar);
        }
        row.appendChild(bars);

        var legend = text("div", "bars-legend");
        legend.appendChild(text("span", null, relative(-days, "day")));
        legend.appendChild(text("span", null,
            total > 0 ? t("uptime", { percent: Math.round(ok * 1000 / total) / 10 }) : t("noData")));
        legend.appendChild(text("span", null, relative(0, "day")));
        row.appendChild(legend);

        var note = text("div", "bar-note", "");
        row.appendChild(note);

        bars.addEventListener("click", function (event) {
            var label = event.target && event.target.getAttribute
                ? event.target.getAttribute("data-label")
                : null;
            note.textContent = label || "";
        });

        return row;
    }

    function serviceName(service) {
        return t("service:" + service.id) || service.name;
    }

    var lastData = null;
    var feedFailed = false;
    var renderedDays = 0;

    function renderStatus(data) {
        lastData = data;

        var updated = Date.parse(data.updatedAt);
        var stale = !isFinite(updated) || (Date.now() - updated) > STALE_MS;
        var services = data.services || [];

        var container = el("services");
        container.textContent = "";

        var days = daysThatFit();
        renderedDays = days;
        services.forEach(function (s) {
            container.appendChild(
                renderService(s, (data.history || {})[s.id], stale, days));
        });

        var down = services.filter(function (s) { return s.status !== "ok"; });

        if (stale) {
            renderBanner(
                { kind: "stale", headline: t("staleHeadline") },
                t("staleSub", { when: formatWhen(updated) }));
        } else if (down.length === 0) {
            renderBanner(
                { kind: "ok", headline: t("okHeadline") },
                t("lastChecked", { when: formatWhen(updated) }));
        } else {
            renderBanner(
                { kind: "down", headline: down.length === 1
                    ? t("oneDown", { name: serviceName(down[0]) })
                    : t("manyDown", { count: down.length }) },
                t("lastChecked", { when: formatWhen(updated) }));
        }
    }

    function formatWhen(ms) {
        if (!isFinite(ms)) { return t("unknownTime"); }
        var mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) { return t("justNow"); }
        if (mins < 60) { return relative(-mins, "minute"); }
        var hours = Math.round(mins / 60);
        if (hours < 24) { return relative(-hours, "hour"); }
        return new Date(ms).toLocaleString(SiteLanguage.code());
    }

    function loadStatus() {
        fetch(STATUS_URL, { cache: "no-store" })
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function (data) {
                feedFailed = false;
                renderStatus(data);
            })
            .catch(function () {
                feedFailed = true;
                renderUnavailable();
            });
    }

    function renderUnavailable() {
        renderBanner({ kind: "stale", headline: t("unavailableHeadline") }, t("unavailableSub"));
    }

    function renderLanguage() {
        if (lastData) { renderStatus(lastData); }
        if (feedFailed) { renderUnavailable(); }
    }

    // ---------------------------------------------------------------------------
    // Operator detail
    //
    // The security boundary here is the network, not this code. Everything below ships
    // to every visitor and is readable in devtools; what a visitor does not have is a
    // route to the host, so the fetch simply never completes for them. Consequently the
    // host is not baked into this file - it is typed once per device and kept in
    // localStorage, which also means no stranger's browser ever emits a request to it.
    // ---------------------------------------------------------------------------

    var HOST_KEY = "ghb.detail.host";
    var API_KEY = "ghb.detail.key";
    var ENVS_KEY = "ghb.detail.envs";

    var ENVIRONMENTS = [
        { id: "production", label: "Production" },
        { id: "staging", label: "Staging" }
    ];

    function store() {
        var saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(ENVS_KEY) || "{}") || {};
        } catch (e) { saved = {}; }

        // Before there were environments a single host was stored flat. That host was
        // production, so it keeps working without the operator retyping anything.
        if (!saved.production) {
            try {
                var legacy = localStorage.getItem(HOST_KEY);
                if (legacy) {
                    saved.production = {
                        host: legacy,
                        key: localStorage.getItem(API_KEY) || ""
                    };
                }
            } catch (e) { /* private mode */ }
        }

        var config = {};
        ENVIRONMENTS.forEach(function (env) {
            var entry = saved[env.id] || {};
            config[env.id] = {
                host: normalizeHost(entry.host),
                key: String(entry.key || "")
            };
        });
        return config;
    }

    function save(config) {
        try {
            localStorage.setItem(ENVS_KEY, JSON.stringify(config));
            localStorage.removeItem(HOST_KEY);
            localStorage.removeItem(API_KEY);
        } catch (e) { /* private mode: nothing persists, this session still works */ }
    }

    // An environment with no host is one that does not exist yet, not one that is down.
    function configured(config) {
        return ENVIRONMENTS.filter(function (env) { return !!config[env.id].host; });
    }

    function normalizeHost(raw) {
        var host = String(raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        // Host and optional port only. Anything else would be a path or query smuggled
        // into the URL this page is about to build.
        return /^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(host) ? host : "";
    }

    function showConfigForm() {
        var current = store();
        var panel = el("detail");
        var body = el("detail-body");

        panel.hidden = false;
        el("detail-hint").textContent =
            "Point this browser at the health endpoints it can reach. Leave an "
            + "environment blank to skip it. Stored on this device only; the page never "
            + "sends it anywhere else.";
        el("detail-buttons").hidden = true;
        body.textContent = "";

        var form = document.createElement("form");
        form.className = "config";

        var inputs = {};

        ENVIRONMENTS.forEach(function (env) {
            var group = document.createElement("fieldset");
            group.appendChild(text("legend", null, env.label));

            var hostLabel = text("label", null, "Host");
            var hostInput = document.createElement("input");
            hostInput.type = "text";
            hostInput.placeholder = "machine.tailnet.ts.net";
            hostInput.autocomplete = "off";
            hostInput.spellcheck = false;
            hostInput.value = current[env.id].host;
            hostLabel.appendChild(hostInput);

            var keyLabel = text("label", null, "Internal API key");
            var keyInput = document.createElement("input");
            keyInput.type = "password";
            keyInput.autocomplete = "off";
            keyInput.value = current[env.id].key;
            keyLabel.appendChild(keyInput);

            group.appendChild(hostLabel);
            group.appendChild(keyLabel);
            form.appendChild(group);

            inputs[env.id] = { host: hostInput, key: keyInput };
        });

        var buttons = text("div", "buttons");
        var submit = text("button", null, "Save");
        submit.type = "submit";
        buttons.appendChild(submit);
        form.appendChild(buttons);

        form.addEventListener("submit", function (event) {
            event.preventDefault();

            var next = {};
            var filled = 0;
            var bad = null;

            ENVIRONMENTS.forEach(function (env) {
                var raw = inputs[env.id].host.value.trim();
                var host = normalizeHost(raw);
                if (raw && !host) { bad = bad || env.label; }
                if (host) { filled++; }
                next[env.id] = { host: host, key: inputs[env.id].key.value.trim() };
            });

            if (bad) {
                el("detail-hint").textContent =
                    "The " + bad.toLowerCase() + " host does not look like a hostname.";
                return;
            }
            if (!filled) {
                el("detail-hint").textContent = "Fill in at least one environment.";
                return;
            }

            save(next);
            if (location.hash === "#config") {
                history.replaceState(null, "", location.pathname);
            }
            loadDetail();
        });

        body.appendChild(form);
    }

    function severity(label, value) {
        if (label === "disk") {
            return value < 15 ? "bad" : value < 25 ? "warn" : "good";
        }
        if (label === "memory") {
            return value < 10 ? "bad" : value < 20 ? "warn" : "good";
        }
        // Load is per core, so 1.0 means the machine is exactly saturated and anything
        // above it is work waiting for a core rather than running on one.
        if (label === "load") {
            return value >= 2 ? "bad" : value >= 1 ? "warn" : "good";
        }
        return value === "ok" ? "good" : "bad";
    }

    function formatUptime(minutes) {
        if (minutes < 60) { return Math.round(minutes) + " min"; }
        if (minutes < 60 * 24) { return (minutes / 60).toFixed(1) + " h"; }
        return (minutes / (60 * 24)).toFixed(1) + " days";
    }

    function appendResourceRows(list, data) {
        if (typeof data.diskFreePercent === "number") {
            pair(list, "Disk free", data.diskFreePercent + "%",
                severity("disk", data.diskFreePercent));
        }

        if (typeof data.memoryFreePercent === "number") {
            pair(list, "Memory free", data.memoryFreePercent + "%",
                severity("memory", data.memoryFreePercent));
        }

        if (typeof data.loadPerCore === "number") {
            pair(list, "CPU load", data.loadPerCore + " per core",
                severity("load", data.loadPerCore));
        }

        var process = data.process;
        if (!process) { return; }

        pair(list, "API memory", process.memoryMb + " MB"
            + (typeof process.memoryPercent === "number"
                ? " (" + process.memoryPercent + "% of limit)"
                : ""));
        pair(list, "API uptime", formatUptime(process.uptimeMinutes));

        // A queue that is empty at every poll is the normal state; a persistent one is
        // thread pool starvation, which otherwise shows up only as unexplained latency.
        if (process.pendingWorkItems > 0) {
            pair(list, "Queued work", process.pendingWorkItems + " items", "warn");
        }
    }

    function pair(list, term, value, className) {
        list.appendChild(text("dt", null, term));
        list.appendChild(text("dd", className, value));
    }

    function renderDetail(data, body) {
        var list = document.createElement("dl");
        list.className = "kv";

        pair(list, "Overall", data.status || "unknown",
            data.status === "ok" ? "good" : data.status === "degraded" ? "warn" : "bad");
        pair(list, "Environment", data.stage || "unknown");
        pair(list, "Database", data.db || "unknown", severity("db", data.db));

        appendResourceRows(list, data);

        body.appendChild(list);

        // One section per room host. The fleet is a list even when it holds one host, so
        // a second host appearing needs no change here - and a host that answered nothing
        // is shown as a failing host rather than left out, which would read as a smaller,
        // healthy fleet.
        var hosts = data.roomHosts || [];

        if (!hosts.length) {
            var empty = document.createElement("dl");
            empty.className = "kv";
            pair(empty, "Room hosts", "none reported", "bad");
            body.appendChild(empty);
        } else {
            hosts.forEach(function (host) {
                renderHost(body, host);
            });
        }
    }

    function renderHost(body, host) {
        body.appendChild(text("h3", "host", "Room host " + (host.hostId || "unnamed")));

        var list = document.createElement("dl");
        list.className = "kv";

        if (!host.reachable || !host.details) {
            // MainApi could not read this host at all, so every field below it is unknown
            // rather than fine. Saying so once is clearer than six "unknown" rows.
            pair(list, "Host", "unreachable", "bad");
            body.appendChild(list);
            return;
        }

        var room = host.details;

        pair(list, "Status", room.status || "unknown",
            room.status === "ok" ? "good" : room.status === "degraded" ? "warn" : "bad");
        pair(list, "Docker API", room.docker || "unknown", severity("d", room.docker));

        appendResourceRows(list, room);

        var ports = room.roomPorts;
        if (ports && typeof ports.total === "number" && ports.total > 0) {
            pair(list, "Room ports", ports.inUse + " / " + ports.total,
                ports.inUse >= ports.total - 2 ? "warn" : "good");
        }

        var crashing = room.crashLooping || [];
        pair(list, "Crash looping",
            crashing.length ? crashing.join(", ") : "none",
            crashing.length ? "bad" : "good");

        var rooms = room.roomResources;
        if (rooms && typeof rooms.count === "number") {
            pair(list, "Room CPU", rooms.cpuPercent + "% over " + rooms.count
                + (rooms.count === 1 ? " room" : " rooms"));
            pair(list, "Room memory", rooms.memoryMb + " MB");
        }

        // A stale sample means the sampler stopped, not that the host is idle, so the age is
        // shown rather than letting old numbers read as current ones.
        if (typeof room.resourceSampleAgeSeconds === "number" && room.resourceSampleAgeSeconds > 120) {
            pair(list, "Resource sample", Math.round(room.resourceSampleAgeSeconds / 60) + " min old", "warn");
        }

        (room.containers || []).forEach(function (container) {
            if (!container.resources) { return; }
            pair(list, container.name,
                container.resources.cpuPercent + "% CPU, "
                + container.resources.memoryMb + " MB");
        });

        body.appendChild(list);
    }

    function loadDetail() {
        var config = store();
        var active = configured(config);

        if (!active.length) {
            // Nothing configured: this browser has never been told a host, so the panel
            // does not exist as far as it is concerned.
            el("detail").hidden = true;
            return;
        }

        var body = el("detail-body");
        el("detail").hidden = false;
        el("detail-hint").textContent = active.length === 1
            ? "Read live from " + active[0].label.toLowerCase() + "."
            : "Read live from " + active.length + " environments.";
        body.textContent = "";
        // The environments answer independently and one being unreachable says nothing
        // about the other, so the buttons are up front rather than after the last reply.
        el("detail-buttons").hidden = false;

        active.forEach(function (env) {
            var section = text("section", "env");
            section.appendChild(text("h3", "env-name", env.label));

            var status = text("p", "hint", "Connecting…");
            section.appendChild(status);

            var content = text("div", null);
            section.appendChild(content);
            body.appendChild(section);

            loadEnvironment(config[env.id], status, content);
        });
    }

    function loadEnvironment(entry, status, content) {
        var timeout = new AbortController();
        var timer = setTimeout(function () { timeout.abort(); }, 8000);

        fetch("https://" + entry.host + "/health/details", {
            headers: { "X-Api-Key": entry.key },
            cache: "no-store",
            signal: timeout.signal
        })
            .then(function (r) {
                if (r.status === 401 || r.status === 403) {
                    throw new Error("rejected");
                }
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function (data) {
                status.textContent = entry.host + " — read " + formatWhen(Date.now()) + ".";
                content.textContent = "";
                renderDetail(data, content);
            })
            .catch(function (error) {
                // "Answered with an error" and "never answered" are different problems
                // with different fixes, and collapsing them into one message sends you
                // looking at the network when the host is in fact replying. A 400 here
                // is almost always host filtering: ASP.NET Core rejects a Host header
                // it does not recognise before routing runs, so the hostname below has
                // to be in the API's AllowedHosts.
                var message = (error && error.message) || "";
                var hint;

                if (message === "rejected") {
                    hint = "The host answered but rejected the key.";
                } else if (message.indexOf("HTTP ") === 0) {
                    hint = "The host answered with " + message
                         + (message === "HTTP 400"
                             ? " — this hostname is probably missing from the API's allowed hosts."
                             : ".");
                } else {
                    hint = "Detail unavailable — this device cannot reach the host. "
                         + "Check you are on the network, and that the hostname is the "
                         + "full name including its domain suffix.";
                }

                status.textContent = entry.host + " — " + hint;
                content.textContent = "";
            })
            .finally(function () { clearTimeout(timer); });
    }

    el("detail-refresh").addEventListener("click", loadDetail);
    el("detail-forget").addEventListener("click", function () {
        try {
            localStorage.removeItem(ENVS_KEY);
            localStorage.removeItem(HOST_KEY);
            localStorage.removeItem(API_KEY);
        } catch (e) { /* nothing to forget */ }
        el("detail").hidden = true;
    });

    window.addEventListener("hashchange", function () {
        if (location.hash === "#config") { showConfigForm(); }
    });

    SiteLanguage.init(STRINGS, renderLanguage);
    loadStatus();
    if (location.hash === "#config") {
        showConfigForm();
    } else {
        loadDetail();
    }

    // Rotating a phone changes how many days fit. Re-render only when the count
    // actually changes, so an address-bar hide/show on iOS is not a rebuild.
    var resizeTimer = null;

    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (!lastData) { return; }
            if (daysThatFit() === renderedDays) { return; }
            renderStatus(lastData);
        }, 150);
    });

    // The tab is often left open on a wall display; without this it would show a
    // green banner from hours ago.
    setInterval(loadStatus, 60 * 1000);
})();
