"use-strict";

const {getter, defineProperty} = require('./utils');
const {ACTION, ACTION_TRIGGERED} = require('./constants');
const EventEmitter = require('./EventEmitter');

module.exports = class Action {
	constructor(name, reducerFn){
		if(!reducerFn)
			reducerFn = name;

		const emitter = new EventEmitter();
		var callCount = 0;
		var undos = {}

		const functor = function functor(payload){
			callCount++;
			emitter.emit(ACTION_TRIGGERED, {token: callCount, payload: payload});

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
		const invoke = (lastState, payload, undoFn, callToken) => {
			if(!undos[callToken])
				undos[callToken] = [];
			undos[callToken].push(undoFn);
			return reducerFn(lastState, payload);
		};

		getter(functor, 'callCount', () => callCount);

		functor.$$name = name
		functor.$$invoke = invoke
		functor.$$type = ACTION
		functor.$$register = (handler) => {
			emitter.on(ACTION_TRIGGERED, handler);
		};

		return functor;
	}

	static get strategies(){
		return {
			HEAD: "HEAD",
			TAIL: "TAIL",
			COMPOUND: "COMPOUND"
		}
	}
}
