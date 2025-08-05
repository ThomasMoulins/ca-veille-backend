const jwt = require("jsonwebtoken");

// Génère un access token court
function generateAccessToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: "20m",
    });
}

// Génère un refresh token long
function generateRefreshToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
        expiresIn: "30d",
    });
}

module.exports = { generateAccessToken, generateRefreshToken };
