const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const rollRoutes = require("./roll.routes");
const chatRoutes = require("./chat.routes");
const postRoutes = require("./post.routes");
const achievementRoutes = require("./achievement.routes");
const newsRoutes = require("./news.routes");

// Mount routes
router.use("/", authRoutes);
router.use("/", userRoutes);
router.use("/", rollRoutes);
router.use("/", chatRoutes);
router.use("/", postRoutes);
router.use("/", achievementRoutes);
router.use("/", newsRoutes);

module.exports = router;
