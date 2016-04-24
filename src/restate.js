
module.exports = function(Immutable, _){
	return {
		Store: require('./store-factory')(Immutable, _),
		Action: require('./Action')
	};
};
