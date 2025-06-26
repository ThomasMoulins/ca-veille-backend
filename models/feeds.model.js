const mongoose = require("mongoose");

const feedsSchema = mongoose.Schema({
    url: { type: String, required: true },
    name: { type: String, required: true },
    articles: [{ type: mongoose.Types.ObjectId, ref: "articles" }],
    defaultMedia: { type: String, default: null },
});

const FeedModel = mongoose.model("feeds", feedsSchema);
module.exports = FeedModel;
