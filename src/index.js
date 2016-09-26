module.exports = require('./factory')(
  require('immutable'),
  () => require('chance').Chance().guid()
);
