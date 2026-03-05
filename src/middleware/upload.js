const multer = require("multer");
const path = require("path");

// For profile pictures (saves to disk temporarily)
const profilePicUpload = multer({ dest: "uploads/" });

// For chat images (memory storage for direct upload to Supabase)
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed!"), false);
    }
    cb(null, true);
  },
});

// For post images
const postImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

// For post videos
const postVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit (Supabase free tier limit)
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "video/mp4",
      "video/quicktime", // iOS .mov files
      "video/x-msvideo", // .avi files
      "video/webm",
      "video/mpeg",
      "video/x-matroska", // .mkv files
    ];

    const allowedExtensions = /mp4|mov|avi|webm|mpeg|mkv/;
    const extname = allowedExtensions.test(
      path.extname(file.originalname).toLowerCase(),
    );

    if (allowedMimeTypes.includes(file.mimetype) && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only video files are allowed!"));
    }
  },
});

module.exports = {
  profilePicUpload,
  chatImageUpload,
  postImageUpload,
  postVideoUpload,
};
