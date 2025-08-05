const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const UserModel = require("../models/users.model");
const { checkBody } = require("../utils/checkBody");
const { tryCatch } = require("../utils/tryCatch");
const {
    generateAccessToken,
    generateRefreshToken,
} = require("../utils/generateToken");

const EMAIL_REGEX = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/g; // regex email, non utilisé
const USERNAME_REGEX = /^[0-9A-Za-z]{6,16}$/; // lettres et/ou chiffres (entre 6 et 16), non utilisé

exports.register = tryCatch(async (req, res) => {
    // Check for empty or missing fields
    if (!checkBody(req.body, ["username", "email", "password"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }

    const { username, email, password } = req.body;
    const formatedEmail = email.toLowerCase();

    // Check if user exists in DB
    const duplicate = await UserModel.findOne({ email: formatedEmail });
    if (duplicate) {
        return res
            .status(409)
            .json({ result: false, error: "Cannot use this email address" });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const newUser = new UserModel({
        username,
        email: formatedEmail,
        password: hashedPassword,
    });

    const createdUser = await newUser.save();

    // Token generation
    const accessToken = generateAccessToken(createdUser._id);
    const refreshToken = generateRefreshToken(createdUser._id);

    createdUser.refreshTokens.push(refreshToken);
    await createdUser.save();

    return res
        .status(201)
        .json({ result: true, username, accessToken, refreshToken });
});

exports.login = tryCatch(async (req, res) => {
    if (!checkBody(req.body, ["email", "password"])) {
        return res
            .status(400)
            .json({ result: false, error: "Missing or empty fields" });
    }

    const { email, password } = req.body;

    // Check if user exists in DB
    const foundUser = await UserModel.findOne({ email });
    if (!foundUser || !bcrypt.compareSync(password, foundUser.password)) {
        return res
            .status(401)
            .json({ result: false, error: "Wrong credentials" });
    }

    // Token generation
    const accessToken = generateAccessToken(foundUser._id);
    const refreshToken = generateRefreshToken(foundUser._id);

    foundUser.refreshTokens.push(refreshToken);
    await foundUser.save();

    // Déstructuration de l'utilisateur pour tout récupérer sauf l'email, le mdp et l'id
    const {
        email: _,
        password: __,
        _id: ___,
        refreshTokens: ____,
        ...safeUser
    } = foundUser.toObject();

    return res
        .status(200)
        .json({ result: true, user: safeUser, refreshToken, accessToken });
});

exports.logout = tryCatch(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "No token" });

    const user = await UserModel.findOne({ refreshTokens: refreshToken });

    if (user) {
        user.refreshTokens = user.refreshTokens.filter(
            (t) => t !== refreshToken
        );
        await user.save();
    }

    return res.json({ result: true, message: "User successfuly disconnected" });
});

exports.refresh = tryCatch(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: "No token" });

    let payload;
    try {
        payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }

    const user = await UserModel.findById(payload.id);
    if (!user || !user.refreshTokens.includes(refreshToken))
        return res.status(401).json({ error: "Invalid token" });

    // Rotation du refresh token
    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    const newRefreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push(newRefreshToken);
    await user.save();

    const {
        email: _,
        password: __,
        _id: ___,
        refreshTokens: ____,
        ...safeUser
    } = user.toObject();

    const accessToken = generateAccessToken(user._id);
    res.json({ user: safeUser, accessToken, refreshToken: newRefreshToken });
});
