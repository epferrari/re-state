// provide factory function
module.exports = function(Immutable, lodash, guidGenerator){
	return {
		Store: require('./lib/store-factory')(Immutable, lodash, guidGenerator),
		Action: require('./lib/action'),
		createActions: require("./lib/create-actions")
	};
};
