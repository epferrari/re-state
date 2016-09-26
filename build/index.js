'use strict';

module.exports = require('./factory')(require('immutable'), function () {
  return require('chance').Chance().guid();
});