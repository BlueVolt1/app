(function () {
    "use strict";

    var STEP_STATES = ["done", "done", "now", "now", "next", "next"];
    var UPDATED = "2026-09-30";

    function formatDate(iso, code) {
        var parts = iso.split("-");
        var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
        return new Intl.DateTimeFormat(code, { dateStyle: "long", timeZone: "UTC" }).format(date);
    }

    function render(code) {
        var steps = document.querySelectorAll("#steps li");
        for (var i = 0; i < steps.length; i++) {
            steps[i].className = STEP_STATES[i];
            steps[i].style.setProperty("--i", i);
            steps[i].querySelector(".state").textContent = SiteLanguage.text(STEP_STATES[i]);
        }

        var done = STEP_STATES.filter(function (state) { return state === "done"; }).length;
        document.getElementById("rig").style.setProperty("--progress", done / (steps.length - 1));
        document.getElementById("updated").textContent =
            SiteLanguage.text("updated", { date: formatDate(UPDATED, code) });
    }

    SiteLanguage.init(STRINGS, render);

    if (document.documentElement.classList.contains("animate")) {
        var chalk = document.getElementById("chalk");
        for (var k = 0; k < 18; k++) {
            var speck = document.createElement("span");
            speck.style.setProperty("--x", Math.random() * 100 + "%");
            speck.style.setProperty("--size", 1.5 + Math.random() * 2.5 + "px");
            speck.style.setProperty("--duration", 9 + Math.random() * 9 + "s");
            speck.style.setProperty("--delay", -Math.random() * 18 + "s");
            speck.style.setProperty("--sway", (Math.random() - 0.5) * 60 + "px");
            chalk.appendChild(speck);
        }
    }

    var entering = document.querySelectorAll(".enter");
    if ("IntersectionObserver" in window) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("shown");
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        entering.forEach(function (node) { observer.observe(node); });
    } else {
        entering.forEach(function (node) { node.classList.add("shown"); });
    }
})();
