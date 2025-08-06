// librairie pour fetch, on récupère la reponse dans une propriété data dans exemple : const response = await axios.get(siteUrl);  const xmlData = response.data;
const axios = require("axios");
// librairie qui permet de parsé le xml et de récupérer en objet js
const xml2js = require("xml2js");
const { htmlToText } = require("html-to-text");
const ArticleModel = require("../models/articles.model");
const FeedModel = require("../models/feeds.model");
const CategoryModel = require("../models/categories.model");

exports.addFeedToBdd = async (siteUrl, categoryId) => {
    const domain = siteUrl.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const regexUrl = new RegExp(`^https?://(?:www\\.)?${domain}`, "i");
    let feedCreated = await FeedModel.findOne({ url: { $regex: regexUrl } });

    const extractImgFromDescription = (description) => {
        if (!description) return null;
        const match = description.match(/<img[^>]+src="([^">]+)"/i);
        return match ? match[1] : null;
    };

    if (!feedCreated) {
        // Étape 1 : Récupère le flux RSS
        const response = await axios.get(siteUrl);
        const xmlData = response.data;

        // Étape 2 : Parser le XML en objet JavaScript
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        // Étape 3 : Extraire les articles
        let items = result?.feed?.entry || result?.rss?.channel?.item || [];
        if (!Array.isArray(items)) items = [items];
        const logo = result?.feed?.logo || result?.rss?.channel?.image?.url;

        // Étape 4 : Trie du plus récent au plus ancien
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
                const imgFromDesc = extractImgFromDescription(
                    item.description || item.content?._ || ""
                );
                const newArticle = new ArticleModel({
                    url: item.link?.$?.href || item.link,
                    title: item.title,
                    description: htmlToText(
                        item.content?._ || item.description,
                        { wordwrap: false }
                    ),
                    media:
                        item.image ||
                        item.enclosure?.$?.url ||
                        item.enclosure?.url ||
                        item["media:content"]?.$?.url ||
                        imgFromDesc ||
                        logo ||
                        null,
                    date: item.updated || item.pubDate,
                    author:
                        item.author?.name ||
                        item.author ||
                        item["dc:creator"] ||
                        "Inconnu",
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

    return { id: feedCreated._id, name: feedCreated.name };
};
