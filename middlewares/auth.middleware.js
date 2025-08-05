const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
    // Récupération du header authorization/Authorization de la requête
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.sendStatus(401);

    const accessToken = authHeader.split(" ")[1];

    // Vérifie l'accessToken (JWT court)
    jwt.verify(accessToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.sendStatus(403);
        req.id = decoded.id;

        // Si tout est bon, l'id est disponible dans nos routes/controlleurs
        next();
    });
};

module.exports = authMiddleware;
