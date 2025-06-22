// test avec duck-duck-scrape

const express = require("express");
const router = express.Router();
const DDG = require("duck-duck-scrape");
const rssFinder = require("rss-finder");
const { checkBody } = require("../utils/checkBody");
const { tryCatch } = require("../utils/tryCatch");
const https = require("https");

/* Agent https (timeout + keep-alive) */
const makeAgent = (insecure = false) =>
    new https.Agent({
        keepAlive: true,
        timeout: 5_000, // coupe après 5 s d’inactivité
        rejectUnauthorized: !insecure,
    });

/* POST new feed */
router.post(
    "/create",
    tryCatch(async (req, res) => {
        if (!checkBody(req.body, ["url"])) {
            return res
                .status(400)
                .json({ result: false, error: "Missing or empty fields" });
        }

        /* ----- Résolution de l’URL via DuckDuckGo ----- */
        const query = req.body.url.trim();
        const { results } = await DDG.search(query, {
            safeSearch: DDG.SafeSearchType.MODERATE,
        });

        const siteUrl = results[0]?.url;
        if (!siteUrl) {
            return res
                .status(403)
                .json(`Impossible de trouver le site pour “${req.body.url}”`);
        }

        /* ----- Détection automatique avec rss-finder ----- */
        const { feedUrls = [] } = await rssFinder(siteUrl, {
            gotOptions: {
                headers: { "user-agent": "Mozilla/5.0" },
                timeout: 10_000,
            },
        }).catch(async (err) => {
            // Retente sans vérification pour les sites ou le certificat est invalide
            if (
                String(err).includes("unable to verify the first certificate")
            ) {
                return rssFinder(siteUrl, {
                    gotOptions: {
                        headers: { "user-agent": "Mozilla/5.0" },
                        timeout: 10_000,
                        https: { rejectUnauthorized: false },
                    },
                });
            }
            throw err;
        });

        if (feedUrls.length) {
            return res.json({ result: true, url: feedUrls[0].url });
        }

        /* ----- Test des différents lien pour trouver le flux rss ----- */
        const homepage = new URL(siteUrl).origin;
        const guesses = [
            "/rss.xml",
            "/feed.xml",
            "/rss",
            "/feed",
            "/atom.xml",
            "/index.xml",
            "/alerte-rss",
        ];

        for (const path of guesses) {
            const candidate = homepage + path;

            const head = await fetch(candidate, {
                method: "HEAD",
                agent: makeAgent(),
                headers: { "user-agent": "Mozilla/5.0" }, // évite les 403 Cloudflare
            }).catch(() => null); // null pour éviter le crash

            let ok =
                head?.ok &&
                /xml|rss|atom/i.test(head.headers.get("content-type") || "");

            /* Si HEAD ne marche pas, on tente GET  */
            if (!ok && (!head || head.status >= 400)) {
                const ctrl = new AbortController();
                const get = await fetch(candidate, {
                    method: "GET",
                    agent: makeAgent(),
                    headers: {
                        "user-agent": "Mozilla/5.0",
                        Range: "bytes=0-131071", // Premier 128 Kio seulement
                    },
                    signal: ctrl.signal,
                }).catch(() => null);

                ok =
                    get?.ok &&
                    /xml|rss|atom/i.test(get.headers.get("content-type") || "");
                ctrl.abort(); // stoppe la lecture au-delà de 128 kio
            }

            if (ok) return res.json({ result: true, url: candidate });
        }

        return res.status(404).json({
            result: false,
            error: "Aucun feed détecté pour cette URL",
        });
    })
);

module.exports = router;
