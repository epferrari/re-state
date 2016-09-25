"use-strict";

const {getter, defineProperty} = require('./utils');
const EventEmitter = require('./event-emitter');
const {
	ACTION, ACTION_TRIGGERED,
	UNDO_ACTION, REDO_ACTION, CANCEL_ACTION
} = require('./constants');


module.exports = class Action {
	constructor(name){

		const emitter = new EventEmitter();
		var emit = emitter.emit.bind(emitter),
				on = emitter.on.bind(emitter),
				callCount = 0,
				calls = {};

		function undo(token){
			emit(UNDO_ACTION, token, (calls[token] || []));
		}

		function redo(token){
			emit(REDO_ACTION, token, (calls[token] || []));
		}

		function cancel(token){
			emit(CANCEL_ACTION, token);
		}

		function flush(){
			calls = {};
		}

		const functor = function functor(payload){
			callCount++;
			emit(ACTION_TRIGGERED, {token: callCount, payload: payload});

			return {
				undo: undo.bind(null, callCount),
				redo: redo.bind(null, callCount),
				cancel: cancel.bind(null, callCount),
				flush(){
					delete calls[callCount];
				}
			};
		};

		functor.didInvoke = (token, auditRecord) => {
			if(!calls[token])
				calls[token] = [];
			calls[token].push(auditRecord);
		};

		getter(functor, 'callCount', () => callCount);
		defineProperty(functor, '$$name', name);
		defineProperty(functor, '$$type', ACTION);
		defineProperty(functor, 'onTrigger', fn => on(ACTION_TRIGGERED, fn));
		defineProperty(functor, 'onUndo', fn => on(UNDO_ACTION, fn));
		defineProperty(functor, 'onRedo', fn => on(REDO_ACTION, fn));
		defineProperty(functor, 'onCancel', fn => on(CANCEL_ACTION, fn));
		defineProperty(functor, 'flush', flush);

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
