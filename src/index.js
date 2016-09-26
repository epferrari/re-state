module.exports = require('./ophelia.factory')(
  require('immutable'),
  () => require('chance').Chance().guid()
);
