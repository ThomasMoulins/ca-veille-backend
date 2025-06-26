const UserModel = require("../models/users.model");
const CategoryModel = require("../models/categories.model");
const { checkBody } = require("../utils/checkBody");
const { tryCatch } = require("../utils/tryCatch");
// create a default category from a predefined list
const { defaultCategories } = require("../modules/defaultCategories");
const { addFeedToBdd } = require("../modules/addFeedToBdd");
const {
    getCategoriesArticles,
    getUsersArticles,
} = require("../modules/getArticles");

// EXPORTS
exports.getUserArticles = tryCatch(async (req, res) => {
    const userId = req.id;
    // récupère la query sous forme d'un tableau grace à un split(",")
    const ids = req.query.ids
        ?.split(",")
        .filter((id) => id && id.trim().length > 0);
    const userCategories = await UserModel.findById(userId);

    const categoriesList = await getCategoriesArticles(
        userCategories.categories
    );
    const userCategoriesList =
        ids && ids.length > 0 ? await getUsersArticles(ids) : [];
    // merge des articles dans un tableau
    const mergedCategories = [];
    categoriesList.forEach((category) =>
        category.articles.forEach((article) => {
            const newArticle = article.toObject();
            newArticle.categoryName = category.name;
            newArticle.categoryColor = category.color;
            newArticle.categoryId = category._id;
            newArticle.username = null;
            newArticle.userId = null;
            mergedCategories.push(newArticle);
        })
    );
    const mergedUsers = [];
    userCategoriesList.forEach((user) =>
        user.articles.forEach((article) => {
            const newArticle = article.toObject();
            newArticle.categoryName = null;
            newArticle.categoryColor = null;
            newArticle.categoryId = null;
            newArticle.username = user.username;
            newArticle.userId = user._id;
            mergedUsers.push(newArticle);
        })
    );
    const mergedArticles = [...mergedCategories, ...mergedUsers];
    const uniqueArticles = [];
    // set permet de stocker des valeurs uniques par id (supprime les doublons)
    const seen = new Set();
    for (const article of mergedArticles) {
        const id = article._id.toString();
        if (!seen.has(id)) {
            seen.add(id);
            uniqueArticles.push(article);
        }
    }
    uniqueArticles.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA;
    });
    if (!uniqueArticles || uniqueArticles.length === 0) {
        return res
            .status(404)
            .json({ result: false, error: "Articles not found" });
    }
    res.json({ result: true, articles: uniqueArticles });
});

// get articles of cartegories by id, feeds merged sort by date
exports.getCategoriesById = tryCatch(async (req, res) => {
    if (!req.query.ids) {
        return res
            .status(400)
            .json({ result: false, error: "Missing categories ids" });
    }
    const ids = req.query.ids?.split(",");
    // method to find in a array of ids, and to populate on multiple leveles
    const categoriesList = await getCategoriesArticles(ids);
    if (!categoriesList || categoriesList.length === 0) {
        return res
            .status(404)
            .json({ result: false, error: "Categories not found" });
    }
    res.json({ result: true, categoriesList });
});

// get articles  of an array of user with id in query, feeds merged sort by date
exports.getCategoriesByUserId = tryCatch(async (req, res) => {
    if (!req.query.ids) {
        return res
            .status(400)
            .json({ result: false, error: "Missing categories ids" });
    }
    const ids = req.query.ids?.split(",");
    // use common function
    const userCategoriesList = await getUsersArticles(ids);
    if (!userCategoriesList || userCategoriesList.length === 0) {
        return res
            .status(404)
            .json({ result: false, error: "Users not found" });
    }
    res.json({ result: true, userList: userCategoriesList });
});

exports.getPopularUsers = tryCatch(async (req, res) => {
    const userId = req.id;
    const users = await UserModel.find({
        isPublic: true,
        //limit to 100 users
    }).limit(100);

    if (!users || users.length === 0) {
        return res
            .status(404)
            .json({ result: false, error: "No popular users found" });
    }
    // remove current user from the list
    const filteredUsers = users.filter(
        (item) => item._id.toString() !== userId.toString()
    );
    // use common function
    const popularsArticles = await getUsersArticles(filteredUsers);
    // mongodb ne respectant pas l'ordre du tableau, il faut trié après le retour
    const test = popularsArticles.sort((a, b) => b.followers - a.followers);
    res.json({ result: true, users: test });
});

exports.deleteCategoryById = tryCatch(async (req, res) => {
    const userId = req.id;
    const categoryId = req.params.categoryId.trim();

    const findCategory = await CategoryModel.findById(categoryId);
    if (!findCategory) {
        return res
            .status(404)
            .json({ result: false, error: "Category not found" });
    }

    if (findCategory.ownerId.toString() !== userId) {
        return res.status(401).json({ result: false, error: "Not authorized" });
    }
    // delete la categorie et la retire du owner
    await CategoryModel.deleteOne({ _id: categoryId });

    await UserModel.updateOne(
        { _id: userId },
        { $pull: { categories: categoryId } }
    );

    return res.status(200).json({ result: true });
});

// create a new category only if the owner dosn't have a category with the same name
exports.createCategory = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["name", "color"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }
    const userId = req.id;
    const { name, color } = req.body;
    const categoryExists = await CategoryModel.findOne({
        name: { $regex: new RegExp(name.trim(), "i") },
        ownerId: userId,
    });
    if (categoryExists) {
        return res
            .status(409)
            .json({ result: false, error: "Category already exists" });
    }

    const newCategory = await CategoryModel.create({
        name: name.trim(),
        color: color.trim(),
        ownerId: userId,
    });

    await UserModel.findByIdAndUpdate(userId, {
        // doublon avec le regex ?
        $addToSet: { categories: newCategory._id },
    });

    return res.status(200).json({ result: true, category: newCategory });
});

exports.createDefaultCategories = tryCatch(async (req, res) => {
    const userId = req.id;
    const { categoriesNames } = req.body;
    if (!categoriesNames || categoriesNames.length === 0) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }

    const categoriesID = [];
    // promise.all attends toutes les promesses avant d'aller à la suite (erreurs incluses)
    await Promise.all(
        categoriesNames.map(async (category) => {
            if (!defaultCategories[category]) {
                return null;
            }

            const { name, color, feeds } = defaultCategories[category];

            const newCategory = await CategoryModel.create({
                name: name.trim(),
                color: color.trim(),
                ownerId: userId.trim(),
                feeds: [],
            });

            const feedsId = [];
            for (const feed of feeds) {
                const feedCreated = await addFeedToBdd(feed, newCategory._id);
                feedsId.push(feedCreated.id);
            }

            await CategoryModel.findByIdAndUpdate(newCategory._id, {
                feeds: feedsId,
            });

            await UserModel.findByIdAndUpdate(userId, {
                $addToSet: { categories: newCategory._id },
            });

            categoriesID.push(newCategory._id);
        })
    );

    return res.status(200).json({ result: true, categoriesID });
});

// updata color of the category if name is different
exports.updateColorCategory = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["categoryId", "color"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }
    const userId = req.id;
    const { color, categoryId } = req.body;
    const findCategory = await CategoryModel.findById(categoryId);
    if (!findCategory) {
        return res
            .status(404)
            .json({ result: false, error: "Category not found" });
    }
    if (findCategory.ownerId.toString() !== userId) {
        return res.status(401).json({ result: false, error: "Not authorized" });
    }
    if (findCategory.color.toString() === color.trim()) {
        return res
            .status(401)
            .json({ result: false, error: "Color already in use" });
    }
    await CategoryModel.findByIdAndUpdate(categoryId, {
        color: color.trim(),
    });
    return res.status(200).json({ result: true });
});

// update the  category name only if the owner dosn't have a category with the same name
exports.updateNameCategory = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["categoryId", "name"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }
    const userId = req.id;
    const { name, categoryId } = req.body;
    const findCategory = await CategoryModel.findById(categoryId);
    if (!findCategory) {
        return res
            .status(404)
            .json({ result: false, error: "Category not found" });
    }
    if (findCategory.ownerId.toString() !== userId) {
        return res.status(401).json({ result: false, error: "Not authorized" });
    }
    const categoryExists = await CategoryModel.findOne({
        name: { $regex: new RegExp(name.trim(), "i") },
        ownerId: userId,
    });
    if (categoryExists) {
        return res
            .status(409)
            .json({ result: false, error: "Category already exists" });
    }
    await CategoryModel.findByIdAndUpdate(categoryId, {
        name: name.trim(),
    });
    return res.status(200).json({ result: true });
});

exports.deleteFeedFromCategory = tryCatch(async (req, res) => {
    const { categoryId, feedId } = req.params;
    const userId = req.id;

    const foundCategory = await CategoryModel.findById(categoryId);
    if (!foundCategory)
        return res.json({ result: false, error: "Category not found" });

    if (foundCategory.ownerId.toString() !== userId)
        return res.status(403).json({
            result: false,
            error: "You can only delete the feeds of your category ${",
        });

    const updatedCategory = foundCategory.feeds.filter(
        (el) => el.toString() !== feedId
    );

    foundCategory.feeds = updatedCategory;
    await foundCategory.save();

    return res.json({ result: true, foundCategory });
});

// les deux fonctions d'update n'étaient jamais utilisées séparément donc création d'une une fonction
exports.updateColorNameCategory = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["categoryId", "color", "name"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }
    const userId = req.id;
    const { color, name, categoryId } = req.body;
    const findCategory = await CategoryModel.findById(categoryId);
    if (!findCategory) {
        return res
            .status(404)
            .json({ result: false, error: "Category not found" });
    }
    if (findCategory.ownerId.toString() !== userId) {
        return res.status(401).json({ result: false, error: "Not authorized" });
    }
    await CategoryModel.findByIdAndUpdate(categoryId, {
        color: color.trim(),
        name: name.trim(),
    });
    return res.status(200).json({ result: true });
});
