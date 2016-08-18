module.exports = require('./ophelia.factory')(
  require('immutable'),
  require('lodash'),
  () => require('chance').Chance().guid()
);
