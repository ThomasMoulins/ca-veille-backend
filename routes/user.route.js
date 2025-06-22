var express = require("express");
const {
    deleteUser,
    getFollowedUsers,
    getEmail,
    deleteUserCategory,
    deleteFollowedUserById,
    addFollowedUserById,
    toggleIsPublic,
    updateUserName,
    logout,
} = require("../controllers/user.controller");
var router = express.Router();

router.get("/followed/:userId", getFollowedUsers);
router.get("/email", getEmail);
router.delete("/", deleteUser);
router.delete("/category/:categoryId", deleteUserCategory);
router.delete("/followed/:followedUserId", deleteFollowedUserById);
router.post("/followed/:userToFollowId", addFollowedUserById);
router.put("/isPublic", toggleIsPublic);
router.put("/", updateUserName);
router.put("/", logout);

module.exports = router;
