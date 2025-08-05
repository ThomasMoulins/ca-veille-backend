const { tryCatch } = require("../utils/tryCatch");
const UserModel = require("../models/users.model");
const CategoryModel = require("../models/categories.model");
const { checkBody } = require("../utils/checkBody");

exports.deleteUser = tryCatch(async (req, res) => {
    const userId = req.id;

    // Check if an id is sent by the auth middleware
    if (!userId)
        return res
            .status(401)
            .json({ result: false, error: "No userID found" });

    // Check if the user exists in the db to delete it
    const foundUser = await UserModel.findByIdAndDelete(userId);
    if (!foundUser)
        return res
            .status(404)
            .json({ result: false, error: "such user doesn't exist" });

    if (foundUser.categories.length > 0) {
        await CategoryModel.deleteMany({ ownerId: userId });
    }
    if (foundUser.followedUsers.length > 0) {
        await UserModel.updateMany(
            { _id: { $in: foundUser.followedUsers } },
            { $inc: { followers: -1 } }
        );
    }
    await UserModel.updateMany(
        { followedUsers: userId },
        { $pull: { followedUsers: userId } }
    );

    return res.json({ result: true });
});

exports.getFollowedUsers = tryCatch(async (req, res) => {
    const { userId } = req.params;

    const user = await UserModel.findById(userId).populate("followedUsers");

    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.followedUsers);
});

exports.getEmail = tryCatch(async (req, res) => {
    const userId = req.id;
    const user = await UserModel.findById(userId);

    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.email);
});

exports.deleteUserCategory = tryCatch(async (req, res) => {
    const { categoryId } = req.params;

    const foundUser = await UserModel.findOne({ _id: req.id });

    if (!foundUser)
        return res.status(403).json({ result: false, error: "Not Authorized" });

    const updatedCategories = foundUser.categories.filter(
        (el) => el.toString() !== categoryId
    );

    foundUser.categories = updatedCategories;
    await foundUser.save();

    return res.json({ result: true, foundUser });
});

exports.deleteFollowedUserById = tryCatch(async (req, res) => {
    const { followedUserId } = req.params;
    const userId = req.id;

    const user = await UserModel.findById(userId);
    const followedUser = await UserModel.findById(followedUserId);

    if (!user)
        return res.status(404).json({ result: false, error: "User not found" });

    if (!followedUser)
        return res
            .status(404)
            .json({ result: false, error: "Followed user not found" });

    if (!user.followedUsers.includes(followedUserId))
        return res
            .status(400)
            .json({ result: false, error: "This user is not followed" });

    const updatedUser = user.followedUsers.filter(
        (el) => el.toString() !== followedUserId
    );

    user.followedUsers = updatedUser;
    await user.save();

    followedUser.followers -= 1;
    await followedUser.save();

    res.json({
        result: true,
        followedUsers: user.followedUsers,
    });
});

exports.addFollowedUserById = tryCatch(async (req, res) => {
    const { userToFollowId } = req.params;
    const userId = req.id;

    const user = await UserModel.findById(userId);
    const followedUser = await UserModel.findById(userToFollowId);

    if (!user)
        return res.status(404).json({ result: false, error: "User not found" });

    if (!followedUser)
        return res
            .status(404)
            .json({ result: false, error: "Followed user not found" });

    if (user.followedUsers.includes(userToFollowId))
        return res
            .status(400)
            .json({ result: false, error: "User already followed" });

    user.followedUsers.push(userToFollowId);
    await user.save();

    followedUser.followers += 1;
    await followedUser.save();

    res.json({
        result: true,
        followedUsers: user.followedUsers,
    });
});

exports.toggleIsPublic = tryCatch(async (req, res) => {
    const userId = req.id;
    const user = await UserModel.findById(userId);

    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    user.isPublic = !user.isPublic;
    await user.save();

    res.status(200).json(user.isPublic);
});

exports.updateUserName = tryCatch(async (req, res) => {
    const userId = req.id;

    // Check all fields
    if (!checkBody(req.body, ["username"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing username" });
    }
    const { username } = req.body;

    if (username.trim() === "") {
        return res
            .status(400)
            .json({ result: false, error: "Problem with username" });
    }

    // Check if the user exists in db
    const foundUser = await UserModel.findByIdAndUpdate(
        { _id: userId },
        { username: username.trim() },
        { new: true }
    );
    if (!foundUser)
        return res
            .status(404)
            .json({ result: true, error: "No such user found" });

    return res.json({ result: true, data: username.trim() });
});
