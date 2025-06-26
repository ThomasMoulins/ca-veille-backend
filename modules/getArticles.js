const CategoryModel = require("../models/categories.model");
const UserModel = require("../models/users.model");

// COMMON FUNCTIONS
// return user name, id and articles of all user's categories sort by date
async function getUsersArticles(ids) {
    const users = await UserModel.find({ _id: { $in: ids } }).populate({
        path: "categories",
        populate: { path: "feeds", populate: { path: "articles" } },
    });
    const userList = users.map((user) => {
        let userObject = {
            username: user.username,
            followers: user.followers,
            _id: user._id,
            articles: [],
        };
        user.categories.map((category) => {
            const articles = [];
            category.feeds.map((feed) => {
                feed.articles.map((article) => articles.push(article));
            });
            userObject.articles = [...userObject.articles, ...articles];
        });
        userObject.articles.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });
        return userObject;
    });
    return userList;
}

// return categories name, id, color and articles of all categories sort by date
async function getCategoriesArticles(ids) {
    const categories = await CategoryModel.find({ _id: { $in: ids } }).populate(
        {
            path: "feeds",
            populate: { path: "articles" },
        }
    );
    const categoriesList = categories.map((category) => {
        const articles = [];
        category.feeds.map((feed) => {
            feed.articles.map((article) => {
                articles.push(article);
            });
        });
        articles.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });
        return {
            _id: category._id,
            name: category.name,
            color: category.color,
            articles,
        };
    });
    return categoriesList;
}

module.exports = { getCategoriesArticles, getUsersArticles };
