"use-strict";

const {getter, defineProperty} = require('./utils');
const {ACTION, ACTION_TRIGGERED} = require('./constants');
const EventEmitter = require('./EventEmitter');

function Action(name, reducerFn){
	if(!reducerFn)
		reducerFn = name;

	const emitter = new EventEmitter();
	var callCount = 0;
	var undos = {}

	const functor = function functor(delta){
		callCount++;
		emitter.emit(ACTION_TRIGGERED, {token: callCount, delta: delta});

		function undo(token){
			if(undos[token]){
				let redos = undos[token].map(fn => fn());
					return () => {
						redos.forEach(fn => fn());
						return undo.bind(null, token);
				};
			}
		}

		// returns a function to undo the action's effect on any state containers listening to it
		// calling undo returns a redo function. calling the redo function returns the undo function.
		// (pretty cool, huh?)
		return undo.bind(null, callCount);
	}

	// wrap the reducer function to apply undo logic
	const invoke = (lastState, deltaMap, undoFn, callToken) => {
		if(!undos[callToken])
			undos[callToken] = [];
		undos[callToken].push(undoFn);
		return reducerFn(lastState, deltaMap);
	};

	const onAction = (handler) => {
		emitter.on(ACTION_TRIGGERED, handler);
	};
	getter(functor, 'callCount', () => callCount);

	functor.$$name = name
	functor.$$invoke = invoke
	functor.$$type = ACTION
	functor.$$register = onAction


	return functor;
}

const strategies = {};
defineProperty(strategies, 'COMPOUND', 'compound');
defineProperty(strategies, 'HEAD', 'head');
defineProperty(strategies, 'TAIL', 'tail');
defineProperty(Action, 'strategies', strategies);

module.exports = Action;
