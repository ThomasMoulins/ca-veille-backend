const cron = require("node-cron");
const axios = require("axios");
const xml2js = require("xml2js");
const { htmlToText } = require("html-to-text");
const UserModel = require("../models/users.model.js");
const FeedModel = require("../models/feeds.model.js");
const ArticleModel = require("../models/articles.model.js");

// La fonction pour updater UN feed (peux être raffinée selon ta logique actuelle)
const updateFeed = async (feed) => {
    try {
        // Étape 1 : Récupère le flux RSS
        const response = await axios.get(feed.url);
        const xmlData = response.data;

        // Étape 2 : Parser le XML en objet JavaScript
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        // Étape 3 : Extraire les articles
        let items = result?.feed?.entry || result?.rss?.channel?.item || [];
        if (!Array.isArray(items)) items = [items];

        // Étape 4 : Trie du plus récent au plus ancien
        items.sort((a, b) => {
            const dateA = new Date(a.updated || a.pubDate);
            const dateB = new Date(b.updated || b.pubDate);
            return dateB - dateA;
        });

        // 5. Liste des URLs dans le flux
        const urls = items
            .map((item) => item.link?.$?.href || item.link)
            .filter(Boolean);

        // 6. Récupérer les articles déjà en BDD (par URL)
        const existingArticles = await ArticleModel.find({
            url: { $in: urls },
        });
        const existingUrls = new Map(
            existingArticles.map((a) => [a.url, a._id])
        );

        // 7. Créer les nouveaux articles qui n'existent pas
        let newArticleIds = [];
        for (const item of items) {
            const url = item.link?.$?.href || item.link;
            if (!url) continue;

            // Vérifie si déjà en base
            if (!existingUrls.has(url)) {
                const article = new ArticleModel({
                    url,
                    title: item.title,
                    description: htmlToText(
                        item.content?._ || item.description || "",
                        { wordwrap: false }
                    ),
                    media:
                        item.enclosure?.$?.url ||
                        item.enclosure?.url ||
                        item.image ||
                        item["media:content"]?.$?.url ||
                        feed.defaultMedia ||
                        null,
                    date: item.updated || item.pubDate,
                    author:
                        item.author?.name ||
                        item.author ||
                        item["dc:creator"] ||
                        "Inconnu",
                });
                const savedArticle = await article.save();
                newArticleIds.push(savedArticle._id);
                existingUrls.set(url, savedArticle._id);
            } else {
                newArticleIds.push(existingUrls.get(url));
            }
        }

        // 8. Compléter jusqu'à 50 articles avec les anciens du feed, par date décroissante
        if (
            newArticleIds.length < 50 &&
            feed.articles &&
            feed.articles.length > 0
        ) {
            // On récupère les anciens articles du feed, hors ceux déjà présents
            const toCompleteIds = feed.articles.filter(
                (id) =>
                    !newArticleIds.some(
                        (newId) => newId.toString() === id.toString()
                    )
            );
            if (toCompleteIds.length > 0) {
                // On récupère leur date pour trier par date décroissante
                const oldArticles = await ArticleModel.find({
                    _id: { $in: toCompleteIds },
                });
                oldArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
                for (const old of oldArticles) {
                    if (newArticleIds.length < 50) {
                        newArticleIds.push(old._id);
                    } else {
                        break;
                    }
                }
            }
        }

        // 9. Mets à jour le feed avec les 50 articles (triés du plus récent au plus ancien)
        const finalArticles = await ArticleModel.find({
            _id: { $in: newArticleIds },
        });
        finalArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
        const finalArticleIds = finalArticles.map((a) => a._id).slice(0, 50);

        await FeedModel.findByIdAndUpdate(feed._id, {
            articles: finalArticleIds,
        });
    } catch (err) {
        console.error(`Erreur mise à jour du feed ${feed.url} :`, err.message);
    }
};

// Boucle sur tous les feeds de la BDD
const updateAllFeeds = async () => {
    const feeds = await FeedModel.find();
    for (const feed of feeds) {
        await updateFeed(feed);
    }

    // Suppression des articles orphelins (non référencés dans aucun feed et non favoris)
    const allFeeds = await FeedModel.find({}, { articles: 1 });
    const usedArticleIds = new Set();
    allFeeds.forEach((feed) => {
        feed.articles.forEach((id) => usedArticleIds.add(id.toString()));
    });

    // Récupère les articles favoris de tous les utilisateurs
    const allUsers = await UserModel.find({}, { favoriteArticles: 1 });
    const favoriteArticleIds = new Set();
    allUsers.forEach((user) => {
        (user.favoriteArticles || []).forEach((id) =>
            favoriteArticleIds.add(id.toString())
        );
    });

    const allArticles = await ArticleModel.find({}, { _id: 1 });
    const orphanIds = allArticles
        .map((a) => a._id.toString())
        .filter((id) => !usedArticleIds.has(id) && !favoriteArticleIds.has(id));
    if (orphanIds.length > 0) {
        await ArticleModel.deleteMany({ _id: { $in: orphanIds } });
        console.log(
            `${orphanIds.length} articles orphelins supprimés (hors favoris).`
        );
    }
};

// Planifie la tâche toutes les 10 minutes
cron.schedule("*/10 * * * *", () => {
    updateAllFeeds();
});

module.exports = { updateAllFeeds };
