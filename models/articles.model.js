const mongoose = require("mongoose");

const articleSchema = mongoose.Schema({
    url: { type: String, required: true },
    title: String,
    description: String,
    media: String,
    date: Date,
    author: String,
});

const ArticleModel = mongoose.model("articles", articleSchema);

module.exports = ArticleModel;
