'use strict'
// Node-only shim so package.json subpath imports can target a real file path
// instead of a bare specifier (which Node's CJS loader rejects in imports).
module.exports = require('fs')
