module.exports = {
  roots: ["<rootDir>/webapp/test/jest"],
  testEnvironment: "node",
  testMatch: ["**/*.test.js"],
  moduleFileExtensions: ["js", "json"],
  collectCoverageFrom: [
    "webapp/services/ReliabilityCore.js",
    "webapp/services/ReliabilityService.js"
  ]
};
