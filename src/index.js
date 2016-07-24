module.exports = require('./factory')(
  require('immutable'),
  require('lodash'),
  () => require('chance').Chance().guid()
);
