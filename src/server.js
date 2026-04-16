require("dotenv").config();

const app = require("./app");

const port = process.env.PORT || 3001;

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Allow up to 5 minutes for large file uploads (videos)
server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;
