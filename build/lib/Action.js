'use strict';
"use-strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var _require = require('./utils');

var getter = _require.getter;
var defineProperty = _require.defineProperty;
var typeOf = _require.typeOf;

var EventEmitter = require('./event-emitter');
var InvalidActionError = require("./errors/InvalidActionError");

var _require2 = require('./constants');

var ACTION = _require2.ACTION;
var TRIGGER_ACTION = _require2.TRIGGER_ACTION;
var UNDO_ACTION = _require2.UNDO_ACTION;
var REDO_ACTION = _require2.REDO_ACTION;
var CANCEL_ACTION = _require2.CANCEL_ACTION;


module.exports = function () {
	function Action(name) {
		var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

		_classCallCheck(this, Action);

		if (typeOf(name) !== 'string') throw new InvalidActionError();

		var emitter = new EventEmitter();
		var emit = emitter.emit.bind(emitter),
		    on = emitter.on.bind(emitter),
		    callCount = 0,
		    calls = {};

		function undo(token) {
			emit(UNDO_ACTION, token, calls[token] || []);
		}

		function redo(token) {
			emit(REDO_ACTION, token, calls[token] || []);
		}

		function cancel(token) {
			emit(CANCEL_ACTION, token);
		}

		function flush() {
			calls = {};
		}

		var functor = function functor(payload) {
			callCount++;

			emit(TRIGGER_ACTION, { token: callCount, payload: payload });

			return {
				undo: undo.bind(null, callCount),
				redo: redo.bind(null, callCount),
				cancel: cancel.bind(null, callCount),
				flush: function flush() {
					delete calls[callCount];
				}
			};
		};

		functor.didInvoke = function (token, auditRecord) {
			if (typeOf(options.flushFrequency) === 'number' && callCount % options.flushFrequency === 0) {
				calls = {};
			} else {
				if (!calls[token]) calls[token] = [];
				calls[token].push(auditRecord);
			}
		};

		getter(functor, 'callCount', function () {
			return callCount;
		});
		defineProperty(functor, '$$name', name);
		defineProperty(functor, '$$type', ACTION);
		defineProperty(functor, 'onTrigger', function (fn) {
			return on(TRIGGER_ACTION, fn);
		});
		defineProperty(functor, 'onUndo', function (fn) {
			return on(UNDO_ACTION, fn);
		});
		defineProperty(functor, 'onRedo', function (fn) {
			return on(REDO_ACTION, fn);
		});
		defineProperty(functor, 'onCancel', function (fn) {
			return on(CANCEL_ACTION, fn);
		});
		defineProperty(functor, 'flush', flush);

		return functor;
	}

	_createClass(Action, null, [{
		key: 'strategies',
		get: function get() {
			return {
				HEAD: "HEAD",
				TAIL: "TAIL",
				COMPOUND: "COMPOUND"
			};
		}
	}]);

	return Action;
}();