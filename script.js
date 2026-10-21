(function () {
    "use strict";

    var statusKey = null;

    function renderStatusPill() {
        if (!statusKey) { return; }
        document.getElementById("status-pill-text").textContent = SiteLanguage.text(statusKey);
    }

    SiteLanguage.init(STRINGS, renderStatusPill);

    // Footer status pill. Reads the same feed as /status, and stays hidden on any failure
    // or stale reading - a landing page should never announce an outage it is not sure of.
    fetch("https://raw.githubusercontent.com/BlueVolt1/app/status-data/status.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
            // Must match STALE_MS in /status: two missed 30-minute runs plus the raw
            // CDN cache. A shorter window here would hide the pill permanently.
            if (Date.now() - Date.parse(data.updatedAt) > 75 * 60 * 1000) { return; }

            var down = (data.services || []).filter(function (s) { return s.status !== "ok"; });
            document.getElementById("status-pill-dot").className =
                "w-2 h-2 rounded-full " + (down.length ? "bg-red-500" : "bg-green-500");
            statusKey = down.length ? "statusDisruption" : "statusNormal";
            renderStatusPill();
            document.getElementById("status-pill").hidden = false;
        })
        .catch(function () { /* feed unreachable: leave the pill hidden */ });

    function reveal() {
        var reveals = document.querySelectorAll(".reveal");
        for (var i = 0; i < reveals.length; i++) {
            if (reveals[i].getBoundingClientRect().top < window.innerHeight - 100) {
                reveals[i].classList.add("active");
            }
        }
    }

    window.addEventListener("scroll", reveal);
    reveal();

    var canvas = document.getElementById("particleCanvas");
    var ctx = canvas.getContext("2d");
    var width, height, particles;

    function init() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        particles = [];

        var particleCount = Math.min(Math.floor(window.innerWidth / 15), 120);

        for (var i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: Math.random() * 2.5 + 0.5,
                vx: (Math.random() - 0.5) * 0.6,
                vy: (Math.random() - 0.5) * 0.6,
                opacity: Math.random() * 0.5 + 0.1
            });
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, width, height);

        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];

            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            for (var j = i + 1; j < particles.length; j++) {
                var p2 = particles[j];
                var dx = p.x - p2.x;
                var dy = p.y - p2.y;
                var distSq = dx * dx + dy * dy;

                // 15000 is approx (122px)^2
                if (distSq < 15000) {
                    ctx.beginPath();
                    ctx.strokeStyle = "rgba(0, 242, 254, " + 0.15 * (1 - distSq / 15000) + ")";
                    ctx.lineWidth = 0.8;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        for (var k = 0; k < particles.length; k++) {
            var dot = particles[k];
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0, 242, 254, " + dot.opacity + ")";
            ctx.shadowBlur = 15;
            ctx.shadowColor = "#00f2fe";
            ctx.fill();
        }

        // Reset shadow so lines don't get blurred on next frame
        ctx.shadowBlur = 0;
    }

    window.addEventListener("resize", init);
    init();
    animate();
})();
