const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    refreshTokens: [{ type: String, default: null }],
    categories: [
        {
            type: mongoose.Types.ObjectId,
            ref: "categories",
        },
    ],
    followedUsers: [{ type: mongoose.Types.ObjectId, ref: "users" }],
    favoriteArticles: [
        {
            type: mongoose.Types.ObjectId,
            ref: "articles",
        },
    ],
    followers: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
});

const UserModel = mongoose.model("users", userSchema);

module.exports = UserModel;
