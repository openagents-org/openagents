'use strict';
// Runs before signing/notarization; checks the bytes electron-builder will ship.
module.exports = require('./check-connector-bundle.cjs').checkPackaged;
