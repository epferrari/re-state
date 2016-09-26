'use strict';

module.exports = function factory(Immutable, guidGenerator) {
	return {
		Store: require('./lib/store-factory')(Immutable, guidGenerator),
		Action: require('./lib/action'),
		createActions: require("./lib/create-actions")
	};
};