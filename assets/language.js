var SiteLanguage = (function () {
    "use strict";

    var STORAGE_KEY = "language";
    var NAMES = { en: "English", ru: "Русский", ja: "日本語" };
    var GLOBE = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>';

    var strings = null;
    var current = "en";

    function saved() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function save(code) {
        try {
            localStorage.setItem(STORAGE_KEY, code);
        } catch (e) { }
    }

    function detect() {
        var preferred = navigator.languages || [navigator.language || ""];
        for (var i = 0; i < preferred.length; i++) {
            var code = String(preferred[i]).slice(0, 2).toLowerCase();
            if (strings[code]) { return code; }
        }
        return "en";
    }

    function text(key, values) {
        var value = strings[current][key];
        if (value === undefined) { value = strings.en[key]; }
        if (value === undefined) { return undefined; }
        return value.replace(/\{(\w+)\}/g, function (match, name) {
            return values && values[name] !== undefined ? values[name] : match;
        });
    }

    function apply(code, onChange) {
        current = code;
        document.documentElement.lang = code;
        document.title = text("pageTitle");

        var nodes = document.querySelectorAll("[data-i18n]");
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = text(nodes[i].getAttribute("data-i18n"));
        }

        var buttons = document.querySelectorAll("#languages button");
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].setAttribute("aria-pressed", String(buttons[j].value === code));
        }

        if (onChange) { onChange(code); }
    }

    function init(pageStrings, onChange) {
        strings = pageStrings;

        var picker = document.getElementById("languages");
        picker.innerHTML = GLOBE;
        Object.keys(NAMES).forEach(function (code) {
            if (!strings[code]) { return; }
            var button = document.createElement("button");
            button.type = "button";
            button.value = code;
            button.textContent = NAMES[code];
            button.addEventListener("click", function () {
                save(code);
                apply(code, onChange);
                var root = document.documentElement;
                root.classList.remove("swap");
                void root.offsetWidth;
                root.classList.add("swap");
            });
            picker.appendChild(button);
        });

        var stored = saved();
        apply(strings[stored] ? stored : detect(), onChange);
    }

    return {
        init: init,
        text: text,
        code: function () { return current; }
    };
})();
