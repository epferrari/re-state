"use strict";
"use-strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var SimpleEventEmitter = function () {
	function SimpleEventEmitter() {
		_classCallCheck(this, SimpleEventEmitter);

		this.listeners = {};
	}

	_createClass(SimpleEventEmitter, [{
		key: "emit",
		value: function emit(event) {
			var listeners = void 0;
			var args = [].slice.call(arguments, 1);
			if (listeners = this.listeners[event]) listeners.forEach(function (l) {
				return l.handler.apply(l.binding, args);
			});
		}
	}, {
		key: "on",
		value: function on(event, handler, thisBinding) {
			var _this = this;

			if (!this.listeners[event]) this.listeners[event] = [];

			var listener = { handler: handler, binding: thisBinding || Object.create(null) };
			this.listeners[event].push(listener);

			// return function to remove listener
			return function () {
				index = _this.listeners[event].indexOf(listener);
				if (index !== -1) _this.listeners[event].splice(index, 1);
			};
		}
	}]);

	return SimpleEventEmitter;
}();

module.exports = SimpleEventEmitter;