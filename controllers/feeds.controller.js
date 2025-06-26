const { tryCatch } = require("../utils/tryCatch");
const { checkBody } = require("../utils/checkBody");
// trouve le flux rss à partir d'une url
const rssFinder = require("rss-finder");
const https = require("https");
const CategoryModel = require("../models/categories.model");
const { addFeedToBdd } = require("../modules/addFeedToBdd");

exports.createFeed = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["url", "categoryId"])) {
        return res
            .status(400)
            .json({ result: false, error: "Champs manquants ou vides" });
    }

    const { url, categoryId } = req.body;
    const query = url.trim();
    // vérifie que c'est une url
    const urlRegex =
        /^(https?:\/\/)(?:[\p{L}\d-]+\.)+[\p{L}]{2,63}(?::\d{2,5})?(?:\/[^\s?#]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?$/u;

    if (!urlRegex.test(query)) {
        return res.status(400).json({
            result: false,
            error: "L'URL entrée n'est pas valide",
        });
    }

    if (!(await CategoryModel.findById(categoryId))) {
        return res.status(404).json({
            result: false,
            error: "Catégorie introuvable",
        });
    }

    /* ----- Détection automatique avec rss-finder ----- */
    const { feedUrls = [] } = await rssFinder(query, {
        gotOptions: {
            headers: { "user-agent": "Mozilla/5.0" },
            timeout: 10_000,
        },
    }).catch(async (err) => {
        // Retente sans vérification pour les sites ou le certificat est invalide
        if (String(err).includes("unable to verify the first certificate")) {
            return rssFinder(query, {
                gotOptions: {
                    headers: { "user-agent": "Mozilla/5.0" },
                    timeout: 10_000,
                    https: { rejectUnauthorized: false },
                },
            });
        }
        throw err;
    });

    if (feedUrls.length && feedUrls[0].url) {
        const feedCreated = await addFeedToBdd(feedUrls[0].url, categoryId);
        return res.status(200).json({
            result: true,
            feedId: feedCreated.id,
            feedName: feedCreated.name,
        });
    }

    const homepage = new URL(query).origin;
    const guesses = [
        "/rss.xml",
        "/feed.xml",
        "/rss",
        "/feed",
        "/feed/rss",
        "/atom.xml",
        "/index.xml",
        "/alerte-rss",
    ];

    /**
     * Agent https (timeout + keep-alive) permet de passer la sécurité empéchant de rercupérer le flux rss
     * ! pas récommandé en prod
     **/
    const makeAgent = (insecure = false) =>
        new https.Agent({
            keepAlive: true,
            timeout: 5_000, // coupe après 5 s d’inactivité
            rejectUnauthorized: !insecure,
        });

    // Boucle sur chaque url du tableau guesses
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

        if (ok) {
            const feedCreated = await addFeedToBdd(candidate, categoryId);
            return res.status(200).json({
                result: true,
                feedId: feedCreated.id,
                feedName: feedCreated.name,
            });
        }
    }
    return res.status(422).json({
        result: false,
        error: "Aucun feed n'a été trouvé pour cette URL",
    });
});

exports.getFeedsByCategory = tryCatch(async (req, res) => {
    const categoryId = req.params.categoryId;
    if (!categoryId) {
        return res.status(400).json({
            result: false,
            error: "Identifiant de la catégorie manquant",
        });
    }

    const category = await CategoryModel.findById(categoryId).populate("feeds");
    if (!category) {
        return res
            .status(404)
            .json({ result: false, error: "Catégorie introuvable" });
    }

    res.status(200).json({ result: true, feeds: category.feeds });
});

exports.getAllFeedsWithCategories = tryCatch(async (req, res) => {
    const userId = req.id;
    const userFeeds = await CategoryModel.find({ ownerId: userId }).populate(
        "feeds"
    );
    if (!userFeeds) {
        return res
            .status(404)
            .json({ result: false, error: "feeds introuvable" });
    }

    res.status(200).json({ result: true, categories: userFeeds });
});
