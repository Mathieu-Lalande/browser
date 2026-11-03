// electron-builder `afterPack` hook: castLabs VMP signing (see vmp-sign.cjs, ADR-040).
module.exports = require("./vmp-sign.cjs").afterPack;
