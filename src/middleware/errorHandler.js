// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message,
    details: err.details || "No additional details available",
  });
};

module.exports = errorHandler;
