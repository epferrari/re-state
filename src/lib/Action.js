"use-strict";

const {getter, defineProperty} = require('./utils');
const {ACTION, ACTION_TRIGGERED, UNDO_ACTION, REDO_ACTION} = require('./constants');
const EventEmitter = require('./EventEmitter');

module.exports = class Action {
	constructor(name){

		const emitter = new EventEmitter();
		var emit = emitter.emit.bind(emitter);
		var callCount = 0;
		var calls = {};

		function undo(token){
			emit(UNDO_ACTION, token, (calls[token] || []));
			return () => {
				emit(REDO_ACTION, token, (calls[token] || []));
				return () => undo(token);
			}
		}

		const functor = function functor(payload){
			callCount++;
			emit(ACTION_TRIGGERED, {token: callCount, payload: payload});

			// returns a function to undo the action's effect on any state containers listening to it
			// calling undo returns a redo function. calling the redo function returns the undo function.
			// (pretty cool, huh?)
			return undo.bind(null, callCount);
		}

		getter(functor, 'callCount', () => callCount);

		defineProperty(functor, '$$name', name)
		defineProperty(functor, '$$type', ACTION)

		defineProperty(functor, 'onTrigger', (handler) => {
			emitter.on(ACTION_TRIGGERED, handler)
		});

		functor.didInvoke = (token, auditRecord) => {
			if(!calls[token])
				calls[token] = [];
			calls[token].push(auditRecord);
		};

		defineProperty(functor, 'onUndo', (handler) => {
			emitter.on(UNDO_ACTION, handler);
		});

		defineProperty(functor, 'onRedo', (handler) => {
			emitter.on(REDO_ACTION, handler);
		});

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
