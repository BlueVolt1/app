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
    // Everything below ships to every visitor, so it holds nothing about the servers. The
    // address and key are typed once per device and kept in localStorage, so no other
    // browser ever sends a request there, and the reply is drawn from its own shape rather
    // than from a schema written down in this file.
    // ---------------------------------------------------------------------------

    var CONFIG_KEY = "ghb.detail.endpoints";
    var OLD_CONFIG_KEYS = ["ghb.detail.envs", "ghb.detail.host", "ghb.detail.key"];
    var REFRESH_MS = 30 * 1000;
    var TIMEOUT_MS = 8000;
    var NARROW = window.matchMedia("(max-width: 560px)");

    var ENVIRONMENTS = [
        { id: "production", label: "Production" },
        { id: "staging", label: "Staging" }
    ];

    var TONES = {
        ok: "good", healthy: "good", pass: "good", up: "good",
        degraded: "warn", warning: "warn",
        fail: "bad", failed: "bad", error: "bad", down: "bad", unhealthy: "bad", unknown: "bad"
    };

    var TONE_ORDER = { bad: 0, warn: 1, good: 2 };

    // Used when storage refuses writes, so a saved setup still works for this visit.
    var unsavedConfig = null;

    function has(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function readStorage(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function readConfig() {
        var saved = unsavedConfig || {};
        if (!unsavedConfig) {
            try { saved = JSON.parse(readStorage(CONFIG_KEY) || "{}") || {}; } catch (e) { saved = {}; }
        }

        var config = {};
        ENVIRONMENTS.forEach(function (env) {
            var entry = saved[env.id] || {};
            config[env.id] = { url: normalizeUrl(entry.url), key: String(entry.key || "") };
        });
        return config;
    }

    // The previous version stored a bare host. It is offered back as the start of an
    // address so only the rest has to be typed.
    function readOldConfig() {
        var old = {};
        try { old = JSON.parse(readStorage("ghb.detail.envs") || "{}") || {}; } catch (e) { old = {}; }
        if (!old.production && readStorage("ghb.detail.host")) {
            old.production = { host: readStorage("ghb.detail.host"), key: readStorage("ghb.detail.key") || "" };
        }

        var config = {};
        ENVIRONMENTS.forEach(function (env) {
            var entry = old[env.id] || {};
            var host = String(entry.host || "").trim();
            config[env.id] = { url: host ? "https://" + host + "/" : "", key: String(entry.key || "") };
        });
        return config;
    }

    function hasOldConfig() {
        return OLD_CONFIG_KEYS.some(function (key) { return !!readStorage(key); });
    }

    function saveConfig(config) {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            OLD_CONFIG_KEYS.forEach(function (key) { localStorage.removeItem(key); });
            unsavedConfig = null;
        } catch (e) {
            unsavedConfig = config;
        }
    }

    function forgetConfig() {
        unsavedConfig = null;
        try {
            localStorage.removeItem(CONFIG_KEY);
            OLD_CONFIG_KEYS.forEach(function (key) { localStorage.removeItem(key); });
        } catch (e) { /* nothing to forget */ }
    }

    // https only, with plain http allowed for a local test server. Credentials in the
    // address are refused: they would ride along on every request in clear view.
    function normalizeUrl(raw) {
        var url;
        try { url = new URL(String(raw || "").trim()); } catch (e) { return ""; }

        var isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) { return ""; }
        if (url.username || url.password) { return ""; }
        return url.href;
    }

    function configured(config) {
        return ENVIRONMENTS.filter(function (env) { return !!config[env.id].url; });
    }

    // --- Setup form ---------------------------------------------------------------

    function showConfigForm(reason) {
        stopRefresh();
        var hasNew = configured(readConfig()).length > 0;
        var current = hasNew || !hasOldConfig() ? readConfig() : readOldConfig();
        var body = el("detail-body");

        el("detail").hidden = false;
        el("detail-hint").textContent = reason
            || "Full address of each environment's detail endpoint. Leave one blank to skip it. "
            + "Stored on this device only.";
        el("detail-buttons").hidden = true;
        body.textContent = "";

        var form = text("form", "config");
        var inputs = {};

        ENVIRONMENTS.forEach(function (env) {
            var group = text("fieldset");
            group.appendChild(text("legend", null, env.label));

            var urlLabel = text("label", null, "Address");
            var urlInput = document.createElement("input");
            urlInput.type = "url";
            urlInput.placeholder = "https://";
            urlInput.autocomplete = "off";
            urlInput.spellcheck = false;
            urlInput.value = current[env.id].url;
            urlLabel.appendChild(urlInput);

            var keyLabel = text("label", null, "Key");
            var keyInput = document.createElement("input");
            keyInput.type = "password";
            keyInput.autocomplete = "off";
            keyInput.value = current[env.id].key;
            keyLabel.appendChild(keyInput);

            group.appendChild(urlLabel);
            group.appendChild(keyLabel);
            form.appendChild(group);
            inputs[env.id] = { url: urlInput, key: keyInput };
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
                var raw = inputs[env.id].url.value.trim();
                var url = normalizeUrl(raw);
                if (raw && !url) { bad = bad || env.label; }
                if (url) { filled++; }
                next[env.id] = { url: url, key: url ? inputs[env.id].key.value.trim() : "" };
            });

            if (bad) {
                el("detail-hint").textContent = "The " + bad.toLowerCase() + " address must be a full https:// address.";
                return;
            }
            if (!filled) {
                el("detail-hint").textContent = "Fill in at least one environment.";
                return;
            }

            saveConfig(next);
            if (location.hash === "#config") {
                history.replaceState(null, "", location.pathname);
            }
            loadDetail();
        });

        body.appendChild(form);
    }

    // --- Reading a value ------------------------------------------------------------

    function words(key) {
        var spaced = String(key)
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .trim()
            .toLowerCase()
            .replace(/\b(cpu|io|ip|url)\b/g, function (word) { return word.toUpperCase(); });
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }

    function toneOf(value) {
        if (typeof value !== "string") { return null; }
        var word = value.toLowerCase();
        return has(TONES, word) ? TONES[word] : null;
    }

    function worse(a, b) {
        if (!a) { return b; }
        if (!b) { return a; }
        return TONE_ORDER[a] <= TONE_ORDER[b] ? a : b;
    }

    function isProblem(tone) {
        return tone === "bad" || tone === "warn";
    }

    function round(value, digits) {
        var factor = Math.pow(10, digits);
        return Math.round(value * factor) / factor;
    }

    function formatNumber(value) {
        return new Intl.NumberFormat(SiteLanguage.code(), { maximumFractionDigits: 2 }).format(value);
    }

    function formatDuration(seconds) {
        if (seconds < 90) { return Math.round(seconds) + " s"; }
        var minutes = seconds / 60;
        if (minutes < 90) { return Math.round(minutes) + " min"; }
        var hours = minutes / 60;
        if (hours < 48) { return round(hours, 1) + " h"; }
        return round(hours / 24, 1) + " days";
    }

    function formatMegabytes(value) {
        return value >= 1024 ? round(value / 1024, 2) + " GB" : Math.round(value) + " MB";
    }

    // Unit suffixes are matched on their camel-case capital, so "thumb" is not megabytes
    // and "backup" is not "up".
    function endsWith(key, suffix) {
        return key === suffix.toLowerCase() || new RegExp("[a-z0-9]" + suffix + "$").test(key);
    }

    function stripSuffix(key, suffix) {
        return key.slice(0, key.length - suffix.length) || key;
    }

    // Reads the unit and direction from the key's own wording. A share of something that
    // should stay high (free space, successes) is bad when low; any other share is bad
    // when high.
    function describeNumber(key, value) {
        if (endsWith(key, "Percent")) {
            var isHighGood = /free|avail|success|hit|uptime/i.test(key);
            var tone = isHighGood
                ? (value < 15 ? "bad" : value < 25 ? "warn" : "good")
                : (value >= 90 ? "bad" : value >= 75 ? "warn" : "good");
            return {
                label: words(stripSuffix(key, "Percent")),
                text: round(value, 1) + "%",
                gauge: value / 100,
                tone: tone
            };
        }
        if (endsWith(key, "PerCore")) {
            return {
                label: words(key),
                text: formatNumber(round(value, 2)),
                tone: value >= 2 ? "bad" : value >= 1 ? "warn" : null
            };
        }
        if (endsWith(key, "Mb")) {
            return { label: words(stripSuffix(key, "Mb")), text: formatMegabytes(value) };
        }
        if (endsWith(key, "Minutes")) {
            return { label: words(stripSuffix(key, "Minutes")), text: formatDuration(value * 60) };
        }
        if (endsWith(key, "Seconds")) {
            return { label: words(stripSuffix(key, "Seconds")), text: formatDuration(value) };
        }
        return { label: words(key), text: formatNumber(value) };
    }

    function hasUnit(key) {
        return ["Percent", "PerCore", "Mb", "Ms", "Minutes", "Seconds"].some(function (suffix) {
            return endsWith(key, suffix);
        });
    }

    // A "no" is only a problem when the key names something that should be true.
    function isExpectedTrue(key) {
        return /reachable|ready|healthy|online|connected/i.test(key) || endsWith(key, "Ok") || endsWith(key, "Up");
    }

    function describeScalar(key, value) {
        if (typeof value === "number") { return describeNumber(key, value); }
        if (typeof value === "boolean") {
            return {
                label: words(key),
                text: value ? "yes" : "no",
                tone: isExpectedTrue(key) ? (value ? "good" : "bad") : null
            };
        }
        if (value === null || value === undefined || value === "" || typeof value === "object") {
            return { label: words(key), text: "—" };
        }
        return { label: words(key), text: String(value), tone: toneOf(value) };
    }

    function isScalar(value) {
        return value === null || typeof value !== "object";
    }

    function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    // An object of numbers with a total reads as one gauge of how much of it is taken: the
    // first other number. Any further numbers ride along in the gauge's text.
    function usageOf(value) {
        if (!isPlainObject(value) || has(value, "status") || typeof value.total !== "number" || value.total <= 0) {
            return null;
        }
        var others = Object.keys(value).filter(function (key) { return key !== "total"; });
        var allNumbers = others.length > 0 && others.every(function (key) { return typeof value[key] === "number"; });
        if (!allNumbers || hasUnit(others[0])) { return null; }

        return {
            used: value[others[0]],
            total: value.total,
            extra: others.slice(1).map(function (key) {
                return words(key).toLowerCase() + " " + formatNumber(value[key]);
            })
        };
    }

    function isFlatGroup(value) {
        return isPlainObject(value) && !has(value, "status") && !usageOf(value)
            && Object.keys(value).every(function (key) { return isScalar(value[key]); });
    }

    function titleKeyOf(item) {
        var keys = Object.keys(item);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var isName = /^(name|id)$/i.test(key) || /[a-z0-9]Id$/.test(key);
            if (isName && typeof item[key] === "string" && item[key]) { return key; }
        }
        return null;
    }

    // A list that is only worth showing when something has gone wrong reads as a warning
    // when it is not empty.
    function isTroubleList(key) {
        return /fail|error|crash|down|unreachable|stuck/i.test(key);
    }

    // Rows whose every value is a scalar, or a small group of scalars, fit a table.
    function isTableRows(items) {
        return items.length > 0 && items.every(function (item) {
            return isPlainObject(item) && !has(item, "status") && Object.keys(item).every(function (key) {
                return isScalar(item[key]) || isFlatGroup(item[key]);
            });
        });
    }

    // The pill takes the worst tone found anywhere inside, so a reply that says "ok" over a
    // failing part says both.
    function statusLabel(status, tone) {
        var hasStatus = status !== null && status !== undefined;
        if (!hasStatus) { return tone === "good" ? "ok" : isProblem(tone) ? "check" : "read"; }
        return isProblem(tone) && tone !== toneOf(status) ? String(status) + " · check" : String(status);
    }

    // A status word this page does not know stays neutral unless something inside is wrong.
    function combinedTone(status, inner) {
        var hasStatus = status !== null && status !== undefined;
        if (hasStatus && !toneOf(status) && !isProblem(inner)) { return null; }
        return worse(hasStatus ? toneOf(status) : null, inner);
    }

    function cardStatus(data) {
        if (has(data, "status")) { return data.status; }
        if (isPlainObject(data.details) && has(data.details, "status")) { return data.details.status; }
        return null;
    }

    // --- Drawing a value ---------------------------------------------------------------

    function pill(tone, label) {
        return text("span", "pill " + (tone || "neutral"), label);
    }

    function gauge(label, fraction, valueText, tone) {
        var row = text("div", "gauge " + (tone || "neutral"));
        var head = text("div", "gauge-head");
        head.appendChild(text("span", "gauge-label", label));
        head.appendChild(text("span", "gauge-value", valueText));
        row.appendChild(head);

        var track = text("div", "gauge-track");
        var fill = text("div", "gauge-fill");
        fill.style.width = Math.max(0, Math.min(1, fraction)) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        return row;
    }

    function tile(label, valueText, tone) {
        var node = text("div", "tile " + (tone || "neutral"));
        node.appendChild(text("div", "tile-label", label));
        node.appendChild(text("div", "tile-value", valueText));
        return node;
    }

    function note(attention, path, label, valueText, tone) {
        if (isProblem(tone)) {
            attention.push({ path: path, label: label, text: valueText, tone: tone });
        }
    }

    function drawTable(container, key, items, path, attention) {
        var columns = [];
        var seen = {};
        var worst = null;

        items.forEach(function (item) {
            Object.keys(item).forEach(function (field) {
                var nested = isFlatGroup(item[field]) ? Object.keys(item[field]) : [null];
                nested.forEach(function (inner) {
                    var id = inner ? field + "." + inner : field;
                    if (!has(seen, id)) {
                        seen[id] = true;
                        columns.push({ field: field, inner: inner });
                    }
                });
            });
        });

        container.appendChild(text("div", "group-title", words(key) + " · " + items.length));

        var scroller = text("div", "table-scroll");
        var table = text("table", "compact");
        var head = text("tr");
        columns.forEach(function (column) {
            head.appendChild(text("th", null, describeScalar(column.inner || column.field, 0).label));
        });
        table.appendChild(head);

        items.forEach(function (item, index) {
            var titleKey = titleKeyOf(item);
            var rowPath = path.concat(titleKey ? item[titleKey] : words(key) + " #" + (index + 1));
            var row = text("tr");

            columns.forEach(function (column) {
                var group = item[column.field];
                var value = column.inner ? (isPlainObject(group) ? group[column.inner] : undefined) : group;
                var shown = describeScalar(column.inner || column.field, value);
                note(attention, rowPath, shown.label, shown.text, shown.tone);
                worst = worse(worst, shown.tone);
                row.appendChild(text("td", isProblem(shown.tone) ? shown.tone : null, shown.text));
            });
            table.appendChild(row);
        });

        scroller.appendChild(table);
        container.appendChild(scroller);
        return worst;
    }

    function drawChips(container, key, values, path, attention) {
        var tone = isTroubleList(key) && values.length ? "warn" : null;
        var row = text("div", "chips-row");
        row.appendChild(text("span", "chips-label", words(key)));

        var chips = text("div", "chips");
        if (!values.length) {
            chips.appendChild(text("span", "chip empty", "none"));
        }
        values.forEach(function (value) {
            chips.appendChild(text("span", "chip" + (tone ? " " + tone : ""), value === null ? "—" : String(value)));
        });
        row.appendChild(chips);
        container.appendChild(row);

        note(attention, path, words(key), values.join(", "), tone);
        return tone;
    }

    // Draws an object's fields into one card body: numbers and words into tiles, shares
    // into gauges, lists into chips, tables or cards, and anything with a status of its own
    // into a nested card. The status itself goes to the card's pill. Returns the worst tone
    // found inside.
    function drawFields(body, data, path, attention, titleKey) {
        var tiles = text("div", "tiles");
        var gauges = text("div", "gauges");
        var rest = text("div", "nested");
        var worst = null;

        Object.keys(data).forEach(function (key) {
            if (key === "status" || key === titleKey) { return; }
            var value = data[key];

            if (key === "details" && isPlainObject(value)) {
                var details = {};
                Object.keys(value).forEach(function (inner) {
                    if (inner !== "status") {
                        details[inner] = value[inner];
                    } else if (has(data, "status")) {
                        details.detailStatus = value.status;
                    }
                });
                worst = worse(worst, drawFields(rest, details, path, attention));
                return;
            }

            if (isScalar(value)) {
                var shown = describeScalar(key, value);
                note(attention, path, shown.label, shown.text, shown.tone);
                worst = worse(worst, shown.tone);
                if (typeof shown.gauge === "number") {
                    gauges.appendChild(gauge(shown.label, shown.gauge, shown.text, shown.tone));
                } else {
                    tiles.appendChild(tile(shown.label, shown.text, shown.tone));
                }
                return;
            }

            var usage = usageOf(value);
            if (usage) {
                var share = usage.used / usage.total;
                var usageTone = usage.used >= usage.total ? "bad" : share >= 0.85 ? "warn" : "good";
                var usageText = formatNumber(usage.used) + " / " + formatNumber(usage.total);
                note(attention, path, words(key), usageText, usageTone);
                worst = worse(worst, usageTone);
                gauges.appendChild(gauge(words(key), share,
                    [usageText].concat(usage.extra).join(" · "), usageTone));
                return;
            }

            if (isFlatGroup(value)) {
                var group = text("div", "group");
                group.appendChild(text("div", "group-title", words(key)));
                worst = worse(worst, drawFields(group, value, path.concat(words(key)), attention));
                rest.appendChild(group);
                return;
            }

            if (Array.isArray(value)) {
                worst = worse(worst, drawList(rest, key, value, path, attention));
                return;
            }

            worst = worse(worst, drawCard(rest, words(key), value, path.concat(words(key)), attention));
        });

        if (gauges.childNodes.length) { body.appendChild(gauges); }
        if (tiles.childNodes.length) { body.appendChild(tiles); }
        if (rest.childNodes.length) { body.appendChild(rest); }
        return worst;
    }

    function drawList(container, key, items, path, attention) {
        if (items.every(isScalar)) {
            return drawChips(container, key, items, path, attention);
        }
        if (isTableRows(items)) {
            return drawTable(container, key, items, path, attention);
        }

        var worst = null;
        items.forEach(function (item, index) {
            var fallback = words(key) + " #" + (index + 1);
            if (isPlainObject(item)) {
                var titleKey = titleKeyOf(item);
                var title = titleKey ? item[titleKey] : fallback;
                worst = worse(worst, drawCard(container, title, item, path.concat(title), attention, titleKey));
            } else if (Array.isArray(item)) {
                worst = worse(worst, drawCard(container, fallback, { items: item }, path.concat(fallback), attention));
            } else {
                worst = worse(worst, drawChips(container, fallback, [item], path, attention));
            }
        });
        return worst;
    }

    function drawCard(container, title, data, path, attention, titleKey) {
        var card = text("details", "card");
        var summary = text("summary");
        summary.appendChild(text("span", "card-title", title));

        var body = text("div", "card-body");
        var inner = drawFields(body, data, path, attention, titleKey);
        var status = cardStatus(data);
        var hasStatus = status !== null && status !== undefined;
        var tone = combinedTone(status, inner);

        if (hasStatus) {
            note(attention, path, "Status", String(status), toneOf(status));
        }
        if (hasStatus || isProblem(tone)) {
            summary.appendChild(pill(tone, statusLabel(status, tone)));
        }

        card.open = !NARROW.matches || isProblem(tone);
        card.setAttribute("data-path", path.join("\u0001"));
        card.setAttribute("data-tone", tone || "");
        card.appendChild(summary);
        card.appendChild(body);
        container.appendChild(card);
        return tone;
    }

    function drawAttention(container, attention) {
        var box = text("div", "attention");
        if (!attention.length) {
            box.className += " clear";
            box.appendChild(text("div", "attention-title", "Nothing needs attention"));
            container.appendChild(box);
            return;
        }

        attention.sort(function (a, b) { return TONE_ORDER[a.tone] - TONE_ORDER[b.tone]; });
        box.appendChild(text("div", "attention-title",
            attention.length === 1 ? "1 thing needs attention" : attention.length + " things need attention"));

        var list = text("ul");
        attention.forEach(function (item) {
            var row = text("li", item.tone);
            var where = item.path.length ? item.path.join(" › ") + " › " : "";
            row.appendChild(text("span", "attention-where", where + item.label));
            row.appendChild(text("span", "attention-value", item.text));
            list.appendChild(row);
        });
        box.appendChild(list);
        container.appendChild(box);
    }

    // --- Loading -------------------------------------------------------------------

    var refreshTimer = null;
    var ageTimer = null;
    var refreshNow = null;
    var loadGeneration = 0;

    function stopRefresh() {
        clearInterval(refreshTimer);
        clearInterval(ageTimer);
        refreshTimer = null;
        ageTimer = null;
        refreshNow = null;
        loadGeneration++;
    }

    function loadDetail() {
        stopRefresh();
        var config = readConfig();
        var active = configured(config);

        if (!active.length) {
            if (hasOldConfig()) {
                showConfigForm("The setup now takes the full address of each endpoint. "
                    + "Finish the addresses below once and save.");
                return;
            }
            el("detail").hidden = true;
            return;
        }

        var body = el("detail-body");
        el("detail").hidden = false;
        el("detail-hint").textContent = "Refreshes every 30 seconds while this tab is open.";
        el("detail-buttons").hidden = false;
        body.textContent = "";

        var generation = loadGeneration;
        var sections = active.map(function (env) {
            var section = text("section", "env");
            var head = text("div", "env-head");
            head.appendChild(text("h3", "env-name", env.label));
            var state = pill(null, "…");
            head.appendChild(state);
            var age = text("span", "env-age", "connecting");
            head.appendChild(age);
            section.appendChild(head);

            var content = text("div", "env-content");
            section.appendChild(content);
            body.appendChild(section);
            return {
                entry: config[env.id], state: state, age: age, content: content,
                readAt: null, problem: null, request: 0
            };
        });

        function refresh() {
            if (document.visibilityState === "hidden") { return; }
            sections.forEach(function (section) { loadEnvironment(section, generation); });
        }

        refreshNow = refresh;
        refresh();
        refreshTimer = setInterval(refresh, REFRESH_MS);
        ageTimer = setInterval(function () { sections.forEach(showAge); }, 1000);
    }

    function formatAge(ms) {
        var seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
        return seconds < 5 ? "just now" : formatDuration(seconds) + " ago";
    }

    function showAge(section) {
        if (section.problem) {
            section.age.textContent = section.readAt
                ? section.problem + " · last read " + formatAge(section.readAt)
                : section.problem;
        } else if (section.readAt) {
            section.age.textContent = "read " + formatAge(section.readAt);
        }
    }

    function loadEnvironment(section, generation) {
        var request = ++section.request;
        var timeout = new AbortController();
        var timer = setTimeout(function () { timeout.abort(); }, TIMEOUT_MS);
        var isCurrent = function () { return generation === loadGeneration && request === section.request; };

        // A redirect would carry the key header to wherever it points, so none is followed.
        fetch(section.entry.url, {
            headers: { "X-Api-Key": section.entry.key },
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: timeout.signal
        })
            .then(function (r) {
                if (r.status === 401 || r.status === 403) { throw new Error("key rejected"); }
                if (!r.ok) { throw new Error("answered HTTP " + r.status); }
                return r.json().catch(function () { throw new Error("reply was not JSON"); });
            })
            .then(function (data) {
                if (!isCurrent()) { return; }
                section.readAt = Date.now();
                section.problem = null;
                showAge(section);
                drawEnvironment(section, data);
            })
            .catch(function (error) {
                if (!isCurrent()) { return; }
                var message = (error && error.message) || "";
                section.problem = error && error.name === "AbortError" ? "no answer in 8 s"
                    : /^(key rejected|answered HTTP|reply was not JSON)/.test(message) ? message
                    : "unreachable from this device";

                section.state.className = "pill bad";
                section.state.textContent = "no reading";
                showAge(section);
            })
            .finally(function () { clearTimeout(timer); });
    }

    function drawEnvironment(section, data) {
        var content = section.content;
        var before = {};
        Array.prototype.forEach.call(content.querySelectorAll("details.card"), function (card) {
            before[card.getAttribute("data-path")] = { open: card.open, tone: card.getAttribute("data-tone") };
        });

        content.textContent = "";
        if (Array.isArray(data)) {
            data = { items: data };
        }
        if (!isPlainObject(data)) {
            section.state.className = "pill bad";
            section.state.textContent = "bad reply";
            content.appendChild(text("p", "hint", "The reply was not an object."));
            return;
        }

        var attention = [];
        var holder = text("div");
        var inner = drawFields(holder, data, [], attention);
        var status = cardStatus(data);
        var hasStatus = status !== null && status !== undefined;
        var tone = combinedTone(status, inner);

        section.state.className = "pill " + (tone || "neutral");
        section.state.textContent = statusLabel(status, tone);

        if (hasStatus && isProblem(toneOf(status))) {
            note(attention, [], "Overall", String(status), toneOf(status));
        } else if (!attention.length && isProblem(tone)) {
            note(attention, [], "Overall", section.state.textContent, tone);
        }
        drawAttention(content, attention);
        content.appendChild(holder);

        // A refresh keeps a card the reader opened or closed, unless its health changed
        // since: a card that just turned bad opens, one that recovered follows the default.
        Array.prototype.forEach.call(content.querySelectorAll("details.card"), function (card) {
            var previous = before[card.getAttribute("data-path")];
            if (previous && previous.tone === card.getAttribute("data-tone")) {
                card.open = previous.open;
            }
        });
    }

    el("detail-refresh").addEventListener("click", function () {
        if (refreshNow) { refreshNow(); } else { loadDetail(); }
    });

    el("detail-forget").addEventListener("click", function () {
        stopRefresh();
        forgetConfig();
        el("detail").hidden = true;
    });

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible" && refreshNow) { refreshNow(); }
    });

    window.addEventListener("hashchange", function () {
        if (location.hash === "#config") {
            showConfigForm();
        } else if (!refreshNow) {
            loadDetail();
        }
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
