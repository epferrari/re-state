// provide factory function
module.exports = function(Immutable, _, guidGenerator){
	return {
		Store: require('./lib/Store')(Immutable, _, guidGenerator),
		Action: require('./lib/Action')
	};
};
