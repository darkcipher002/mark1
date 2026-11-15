const fs = require("fs"), assert = require("assert");
assert.equal(fs.readFileSync("public/js/billing.js", "utf8"), fs.readFileSync("api/_lib/billing.js", "utf8"), "api/_lib/billing.js is out of sync — run: npm run sync");
console.log("billing copies in sync");
