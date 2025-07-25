require("dotenv").config();
require("./config/connection");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const cors = require("cors");
require("./modules/rssUpdater");

var indexRouter = require("./routes/index");
const authRouter = require("./routes/auth.route");
const feedsRouter = require("./routes/feeds.route");
const categoriesRouter = require("./routes/categories.route");
const articlesRouter = require("./routes/articles.route");
const userRouter = require("./routes/user.route");
const { errorHandler } = require("./middlewares/errorHandler");
const authMiddleware = require("./middlewares/auth.middleware");

var app = express();

app.use(cors());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use(authMiddleware);
app.use("/users", userRouter);
app.use("/categories", categoriesRouter);
app.use("/feeds", feedsRouter);
app.use("/articles", articlesRouter);
app.use(errorHandler);

module.exports = app;
