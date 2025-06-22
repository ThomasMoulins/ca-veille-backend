// librairie pour fetch, on récupère la reponse dans une propriété data dans exemple : const response = await axios.get(siteUrl);  const xmlData = response.data;
const axios = require("axios");
// librairie qui permet de parsé le xml et de récupérer en objet js
const xml2js = require("xml2js");
const { htmlToText } = require("html-to-text");
const { tryCatch } = require("../utils/tryCatch");
const { checkBody } = require("../utils/checkBody");
// trouve le flux rss à partir d'une url
const rssFinder = require("rss-finder");
const https = require("https");
const ArticleModel = require("../models/articles.model");
const FeedModel = require("../models/feeds.model");
const CategoryModel = require("../models/categories.model");

/* Agent https (timeout + keep-alive) permet de passer la sécurité empéchant de rercupérer le flux rss, pas récommandé en prod*/
const makeAgent = (insecure = false) =>
    new https.Agent({
        keepAlive: true,
        timeout: 5_000, // coupe après 5 s d’inactivité
        rejectUnauthorized: !insecure,
    });

const addFeedToBdd = async (siteUrl, categoryId, res) => {
    const domain = siteUrl.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const regexUrl = new RegExp(`^https?://(?:www\\.)?${domain}`, "i");
    let feedCreated = await FeedModel.findOne({ url: { $regex: regexUrl } });

    if (!feedCreated) {
        // Étape 1 : Faire une requête HTTP pour récupérer le flux RSS
        const response = await axios.get(siteUrl);
        const xmlData = response.data;

        // Étape 2 : Parser le XML en objet JavaScript
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        // Étape 3 : Extraire les articles
        let items = result?.feed?.entry || result?.rss?.channel?.item;
        const logo = result?.feed?.logo || result?.rss?.channel?.image?.url;

        // Étape 4 : Tri du plus récent au plus ancien
        items.sort((a, b) => {
            const dateA = new Date(a.updated || a.pubDate);
            const dateB = new Date(b.updated || b.pubDate);
            return dateB - dateA;
        });

        // Étape 5 : Limite à 50 articles
        items = items.slice(0, 50);
        // test toutes  les balises connues en xml pour récupérer les champs
        const articleArray = await Promise.all(
            items.map(async (item) => {
                const newArticle = new ArticleModel({
                    url: item.link?.$?.href || item.link,
                    title: item.title,
                    description: htmlToText(
                        item.content?._ || item.description,
                        {
                            wordwrap: false,
                            ignoreHref: true,
                            ignoreImage: true,
                        }
                    ),
                    media:
                        item.enclosure?.$?.url ||
                        item.enclosure?.url ||
                        item.image ||
                        item["media:content"]?.$?.url ||
                        null,
                    date: item.updated || item.pubDate,
                    author:
                        item.author?.name ||
                        item.author ||
                        item["dc:creator"] ||
                        "Inconnu",
                    defaultMedia: logo,
                });
                const savedArticle = await newArticle.save();
                return savedArticle._id;
            })
        );

        const domainName = new URL(siteUrl).hostname.replace(/^www\./, "");

        const feed = new FeedModel({
            url: siteUrl,
            name: domainName,
            articles: articleArray,
            defaultMedia: logo,
        });

        feedCreated = await feed.save();
    }

    await CategoryModel.findByIdAndUpdate(categoryId, {
        $addToSet: { feeds: feedCreated._id },
    });

    return res.status(200).json({
        result: true,
        feedId: feedCreated._id,
        feedName: feedCreated.name,
    });
};

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

    if (feedUrls.length && feedUrls[0].url)
        return addFeedToBdd(feedUrls[0].url, categoryId, res);

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
            return addFeedToBdd(candidate, categoryId, res);
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
