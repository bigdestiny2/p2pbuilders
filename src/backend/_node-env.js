'use strict'
// Node-only shim to match the shape that `bare-env` returns under Bare.
// Referenced by the `#env` subpath import defined in package.json.
module.exports = process.env
