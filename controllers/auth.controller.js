const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const UserModel = require("../models/users.model");
const { checkBody } = require("../modules/checkBody");
const { tryCatch } = require("../utils/tryCatch");

const EMAIL_REGEX = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/g; // regex email, non utilisé
const USERNAME_REGEX = /^[0-9A-Za-z]{6,16}$/; // lettres et/ou chiffres (entre 6 et 16), non utilisé

function generateAccessToken(id) {
    /* 
        Il y a 3 paramètres à récupérer pour l'encodage du token:
        1/ les propriétés à encoder, ici ça sera uniquement l'id
        2/ la clé secrète
        3/ le délai d'expiration du token
    */
    return jwt.sign({ id }, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    });
}

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
    const token = generateAccessToken(createdUser._id);

    const updatedUser = await UserModel.findOneAndUpdate(
        { email: formatedEmail },
        { token: token },
        { new: true } // Retourne l'utilisateur mis à jour
    );

    // Déstructuration de l'utilisateur pour tout récupérer sauf l'email, le mdp et l'id
    const {
        email: _,
        password: __,
        _id: ___,
        ...safeUser
    } = updatedUser.toObject();

    return res.status(201).json({ result: true, user: safeUser });
});

exports.login = tryCatch(async (req, res) => {
    // Check for empty or missing fields
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
    const token = generateAccessToken(foundUser._id);

    const updatedUser = await UserModel.findOneAndUpdate(
        { _id: foundUser._id },
        { token: token },
        { new: true } // Retourne l'utilisateur mis à jour
    );

    // Déstructuration de l'utilisateur pour tout récupérer sauf l'email, le mdp et l'id
    const {
        email: _,
        password: __,
        _id: ___,
        ...safeUser
    } = updatedUser.toObject();

    return res.status(200).json({ result: true, user: safeUser });
});
