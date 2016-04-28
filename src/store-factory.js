"use-strict";

const Action = require('./Action');
const {getter, defineProperty} = require('./utils');
const {ACTION} = require('./constants');
const EventEmitter = require('./EventEmitter');

var chance = require('chance').Chance();

module.exports = function StoreFactory(Immutable, _){

	let {isPlainObject, isFunction, isArray, merge, reduce, chain, contains} = _;

	// events
	const CHANGE_EVENT = 'STATE_CHANGE';
	const SET_EVENT = 'SET_INVOKED';
	const REDUCE_EVENT = 'REDUCE_INVOKED';
	const ACTION_ADDED = "ACTION_ADDED";


	class InvalidDeltaError extends Error {
		constructor(){
			super();
			this.name = "InvalidDelta";
			this.message = "a deltaMap passed to merge into state must be an object literal";
			this.stack = (new Error()).stack;
		}
	}

	class InvalidReturnError extends Error {
		constructor(){
			super();
			this.name = "InvalidReturn";
			this.message = "a reducer must return an object literal to reduce into state";
		}
	}

	class InvalidReducerError extends Error {
		constructor(){
			super()
			this.name = "InvalidReducer";
			this.message = "a reducer must be created by the Action factory with `new Restate.Action(<reducer>)`"
		}
	}

	class InvalidIndexError extends Error {
		constructor(){
			super();
			this.name = "InvalidHistoryIndex";
			this.message = "history index must be an integer";
		}
	}

	return class StateStore {
		/**
		* @constructs StateStore
		* @param {object} initialState={} - an initial state for your store
		* @param {array} [middleware=[]] - an array of middleware functions to apply during state transitions
		*/
		constructor(initialState, middleware){
			var $$history,
					$$index,
					$$reducers,
					$$middleware,
					emitter,
					queueReduceCycle,
					executeReduceCycle,
					resolveReducer,
					resolveDelta,
					applyMiddleware,
					undo,
					merger,
					rewriteHistory;

			if(typeof initialState !== 'undefined' && !isPlainObject(initialState))
				throw new InvalidDeltaError();

			// pointer to current state of $$history
			$$index = 0;

			// list of reducers invoked to change state
			$$reducers = Immutable.List();

			// private stack of [reducer index, Immutable Map app state]
			$$history = [{
				reducer_invoked: 0,
				delta: {},
				$state: Immutable.Map().merge(initialState),
				guid: chance.guid()
			}];

			$$middleware = _.isArray(middleware) ? middleware : [];

			emitter = new EventEmitter();



			getter(this, 'emitter', () => emitter );
			getter(this, 'reducers', () => $$reducers.toJS() );
			getter(this, 'previousStates', () => $$history.length);
			getter(this, 'history', () => $$history);
			getter(this, 'index', () => $$index);
			getter(this, 'state', () => {
				let state = Immutable.Map($$history[$$index].$state).toJS();
				return reduce(state, (acc, val, key) => {
					if(val !== undefined)
						acc[key] = val;
					return acc;
				}, {});
			});



			// respect "$unset" value passed to remove a value from state
			merger = function merger(prev, next, key){
				if(next == "$unset")
					return undefined;
				else if(next === undefined)
					return prev;
				else
					return next;
			};



			undo = function undo(atIndex, guid){
				// ensure that the history being undone is actually the state that this action created
				// if the history was rewound, branched, or replaced, this action no longer affects the stack
				// and an undo could break the history tree in unpredicatable ways
				if($$history[atIndex] && $$history[atIndex].guid === guid){

					let originalHistory = $$history[atIndex];
					let lastHistory = $$history[atIndex - 1];

					let redo = () => {
						$$history[atIndex] = originalHistory;
						rewriteHistory(atIndex + 1);
					};

					if($$history[atIndex].reducer_invoked == 0)
						// undo was already called
						return redo;

					// duplicate the history state at cachedIndex as if action was never called
					$$history[atIndex] = {
						reducer_invoked: 0,
						delta: {},
						$state: lastHistory.$state,
						guid: originalHistory.guid
					}

					// revise subsequent history entries according to revised state at targetIndex
					rewriteHistory(atIndex);

					// return a function to undo the undo
					return redo;
				} else {
					// return a no-op;
					return () => {};
				}

			}.bind(this);



			rewriteHistory = function rewriteHistory(fromIndex){
				let lastHistory = $$history[fromIndex - 1];

				$$history
				.slice(fromIndex)
				.reduce((last, curr, i) => {
					let reducerToApply = this.reducers[curr.reducer_invoked];
					let revisedState = reducerToApply.$invoke(last.$state.toJS(), curr.delta);
					let revisedHistory = {
						reducer_invoked: curr.reducer_invoked,
						delta: curr.delta,
						$state: last.$state.mergeDeepWith(merger, revisedState),
						guid: curr.guid
					}
					// revise the entry
					$$history[fromIndex + i] = revisedHistory;
					return revisedHistory;
				}, lastHistory);

				this.trigger();
			}.bind(this);



			applyMiddleware = function applyMiddleware(actionName, actionInvoke){
				if($$middleware.length)
					return $$middleware.map(m => m).reverse().reduce((next, fn) => {
						return (delta) => {
							let resolvedVal = undefined;
							let nextResolver = () => {
								// ensure that next is only called once!
								if(!resolvedVal)
									resolvedVal = next(delta);
								return resolvedVal;
							};
							return fn(nextResolver, actionName, delta, this.state);
						};
					}, actionInvoke);
				else
					return actionInvoke;
			}.bind(this);



			resolveDelta = function resolveDelta(lastState, delta, reducer, callToken){
				let guid = chance.guid();
				let undoDelta = undo.bind(this, ($$index + 1), guid);

				let resolver = (d) => {
					let resolvedState = reducer.$invoke(lastState, d, undoDelta, callToken);

					if( !isPlainObject(resolvedState) ) {
						throw new InvalidReturnError();
					} else {
						return resolvedState;
					}
				}

				let newState = applyMiddleware(reducer.name, resolver)(delta);

				// add a new state to the $$history and increment index
				// return state to the next reducer
				let newImmutableState = $$history[$$index].$state.mergeDeepWith(merger, newState);

				if(!Immutable.is($$history[$$index].$state, newImmutableState)){
					$$history = $$history.slice(0, $$index + 1);
					// add new entry to history
					$$history.push({
						reducer_invoked: reducer.index,
						delta: delta,
						$state: newImmutableState,
						guid: guid
					});
					// update the pointer to new state in $$history
					$$index++;
				}
				return newState;
			}.bind(this);



			resolveReducer = function resolveReducer(lastState, reducer){
				let req, resolver;

				switch((reducer.strategy || "").toLowerCase()){
					case (Action.strategies.COMPOUND.toLowerCase()):
						// reduce down all the deltas
						return reducer.requests.reduce((state, r) => {
							return resolveDelta(state, r.delta, reducer, r.token);
						}, lastState);
					case (Action.strategies.HEAD.toLowerCase()):
						// transform using the first delta queued
						req = reducer.requests[0];
						return resolveDelta(lastState, req.delta, reducer, req.token);
					case (Action.strategies.TAIL.toLowerCase()):
						// resolve using the last delta queued
						req = reducer.requests.pop();
						return resolveDelta(lastState, req.delta, reducer, req.token);
					default:
						// use tailing strategy
						req = reducer.requests.pop();
						return resolveDelta(lastState, req.delta, reducer, req.token);
				}
			};



			/**
			*
			* @desc reduce a series of new states from pending $$reducers
			* @private
			*/
			executeReduceCycle = function executeReduceCycle(previousState){
				this.emitter.emit(REDUCE_EVENT);
				let initialIndex = $$index;
				let maybeNewState = chain($$reducers.toJS())
					.filter(reducer => reducer.requests.length)
					.sortBy(reducer => reducer.index)
					.reduce((state, reducer) => {

						// run the state through the reducer
						let newState = resolveReducer(state, reducer);

						// clear deltaMaps for the next cycle and create new immutable list
						$$reducers = $$reducers.update(reducer.index, r => {
							r.requests = [];
							return r;
						});

						return newState;
					}, merge({}, previousState) )
					.value();

				// notify on change
				if(initialIndex !== $$index ){
					this.trigger()
				}
			}.bind(this);



			let reducePending = false;
			/**
			*
			* @desc queue a reduce cycle on next tick
			* @private
			*/
			queueReduceCycle = function queueReduceCycle(index, token, delta){
				// update reducer hash in $$reducers with deltaMap
				$$reducers = $$reducers.update(index, reducer => {
					reducer.requests.push({delta: delta, token: token});
					return reducer;
				});

				// defer a state reduction on the next tick if one isn't already queued
				if(!reducePending){
					reducePending = true;
					setTimeout(() => {
						executeReduceCycle(this.state);
						reducePending = false;
					}, 0);
				}
			}.bind(this);



			let listenToAction = function listenToAction(action, strategy){
				if((action.$$type == ACTION)){
					let index = $$reducers.size;

					let reducer = {
						name: action.$$name,
						$invoke: (lastState, delta, undoFn, token) => {
							/* maybe middleware here later */
							return action.$$invoke(lastState, delta, undoFn, token);
						},
						index: index,
						strategy: strategy,
						requests: []
					};

					// only add each Action once
					if(!contains($$reducers.toJS(), reducer)){
						$$reducers = $$reducers.push(reducer);

						// kick off a reduce cycle when the reducer action is called anywhere in the app
						let handler = (payload) => queueReduceCycle(index, payload.token, payload.delta);
						action.$$register(handler);

						let registration = {action: action.$$name, index: index}
						emitter.emit(ACTION_ADDED, registration)
						return registration;
					}
				} else {
					throw new InvalidReducerError();
				}
			}.bind(this);


		/**
		*
		* @name listenTo
		* @param {function | array} action - created with `new Restate.Action(<reducer_function>)`
		*   If passed an array, strategies can be defined like so: `[{action: <Action>[, strategy: <strategy>]}]`.
		*   Object definitions and plain actions can be combined in the same array:
		*   `[<Action>, {action: <Action>, strategy: <strategy>}, <Action>]`
		* @param {string} [strategy=tail] - one of `'compound'`, `'lead'`, or `'tail'`
		* @desc execute a reduce cycle when the action is called
		* @method
		* @instance
		* @memberof StateStore
		*/
			this.listenTo = function listenTo(action, strategy){
				if(isFunction(action)){
					return listenToAction(action, strategy);
				} else if(isArray(action)){
					return action.reduce((acc, a) => {
						if(isFunction(a)){
							// [<Action>, <Action>, ...]
							acc[a.$$name] = listenToAction(a);
						} else if(isPlainObject(a)){
							// [{action: <Action>[,strategy: <strategy>], ...}]
							acc[a.action.$$name] = listenToAction(a.action, a.strategy);
						}
						return acc;
					}, {});
				}
			}.bind(this);

			// set the store's first reducer as a noop
			let noop = new Action('noop', (lastState) => lastState);
			this.listenTo(noop);

			// set a second reducer to handle direct setState operations
			let $set = new Action('setState', (lastState, deltaMap) => {
				let newState = merge({}, lastState, deltaMap);
				return newState;
			});
			this.listenTo($set, Action.strategies.COMPOUND);


		/**
		*
		* @name setState
		* @desc Reduce an updated state on the next tick by merging a plain object.
		* @param {object} deltaMap - a plain object of properties to be merged into state. Set a property's
		*   value to the reserved keyword `"$unset"` to have the property removed from state.
		* @method
		* @instance
		* @fires CHANGE_EVENT
		* @memberof StateStore
		*/
			this.setState = function setState(deltaMap){
				if(!isPlainObject(deltaMap)){
					throw new InvalidDeltaError();
				} else {
					return $set(deltaMap);
				}
			};


			// set a third reducer that entirely replaces the state with a new state
			let $replace = new Action('replaceState', (lastState, newState) => {
				return reduce(lastState, (acc, val, key) => {
					acc[key] = newState[key] || "$unset";
					return acc;
				}, newState);
			});

			this.listenTo($replace, Action.strategies.TAIL)


		/**
		*
		* @name replaceState
		* @desc replace the current state with a new state. Be aware that reducers coming after may expect properties
		*   that no longer exist on the state you replace with. Best to keep them the same shape.
		* @param {object} newState - a plain object of properties to be merged into state
		* @method
		* @instance
		* @fires CHANGE_EVENT
		* @memberof StateStore
		*/
			this.replaceState = function replaceState(newState){
				if(!isPlainObject(newState)){
					throw new InvalidDeltaError();
				} else {
					return $replace(newState);
				}
			};

		/**
		*
		* @name reset
		* @desc Reset the app to it's original state. A hard reset will delete the state history, set the
		*   index to 0, and trigger with initial state. A soft reset will add a new entry to the end of
		*   history as initial state.
		* @param {boolean} hard=false - DESTRUCTIVE! delete entire history and start over at history[0]
		* @method
		* @instance
		* @memberof StateStore
		* @fires CHANGE_EVENT
		*/
			this.reset = function reset(hard){
				if(hard === true){
					// hard reset, clears the entire $$history stack, no previous histories are saved
					$$history = [$$history[0]];
					$$index = 0;
				} else {
					// soft reset, push the initial state to the end of the $$history stack
					$replace(this.getInitialState());
				}

				this.trigger();
			}.bind(this);

		/**
		*
		* @name resetToState
		* @desc reset the StateStore's history to an index. DESTRUCTIVE! Deletes history past index.
		* @param {int} index - what state to move the history to
		* @method
		* @instance
		* @memberof StateStore
		* @fires CHANGE_EVENT
		*/
			this.resetToState = function resetToState(index){
				if(!Number.isInteger(index)){
					throw new InvalidIndexError();
				} else if(index >= 0 && index <= $$history.length -1){
					$$index = index;
					$$history = $$history.slice(0, $$index);
					this.trigger();
				}
			}.bind(this);

		/**
		*
		* @name fastForward
		* @desc move the StateStore's history index ahead `n` frames. Does not alter history.
		* @param {int} n=1 - how many frames to fast froward. Cannot fast forward past the last frame.
		* @method
		* @instance
		* @memberof StateStore
		* @fires CHANGE_EVENT
		*/
			this.fastForward = function fastForward(n){
				if(n !== undefined && !Number.isInteger(n)){
					throw new InvalidIndexError();
				} else {
					n = (n || 1)
					// ensure we don't go past the end of history
					$$index = Math.min( ($$index + Math.abs(n)), ($$history.length - 1));
					this.trigger();
				}
			}.bind(this);

		/**
		*
		* @name rewind
		* @desc move the StateStore's history index back `n` frames. Does not alter history.
		* @param {int} n=1 - how many frames to rewind. Cannot rewind past 0.
		* @method
		* @instance
		* @memberof StateStore
		* @fires CHANGE_EVENT
		*/
			this.rewind = function rewind(n){
				if(n !== undefined && !Number.isInteger(n)){
					throw new InvalidIndexError();
				} else {
					n = (n || 1)
					// ensure we don't go past the beginning of time
					$$index = Math.max( ($$index - Math.abs(n)), 0)
					this.trigger();
				}
			}.bind(this);

		/**
		*
		* @name goto
		* @desc move the StateStore's history index to `index`. Does not alter history.
		* @param {int} index - the index to move to
		* @method
		* @instance
		* @memberof StateStore
		* @fires CHANGE_EVENT
		*/
			this.goto = function goto(index){
				if(!Number.isInteger(index)){
					throw new InvalidIndexError();
				} else if(index >= 0 && index <= $$history.length -1){
					$$index = index;
					this.trigger();
				}
			}.bind(this);
		}

		/**
		*
		* @name getImmutableState
		* @desc Get the current state as an Immutable Map
		* @method
		* @instance
		* @memberof StateStore
		* @returns {Immutable.Map}
		*/
		getImmutableState(){
			return Immutable.Map(this.history[this.index].$state);
		}


		/**
		*
		* @name getInitialState
		* @desc Get the initial app state that was passed to the constructor
		* @method
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		getInitialState(){
			return this.history[0].$state.toJS();
		}


		/**
		*
		* @name getStateAtIndex
		* @desc Get the app's state at a version in the state $$history
		* @param {int} index
		* @method
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		getStateAtIndex(index){
			if(this.history[index])
				return this.history[index].toJS();
		}

		/**
		*
		* @name addListener
		* @desc add listener for changes to the store state
		* @param {function} listener
		* @param {object} [thisBinding=Object.create(null)]
		* @returns {function} an unlisten function for the listener
		* @method
		* @instance
		* @memberof StateStore
		*/
		addListener(listener, thisBinding){
			return this.emitter.on(CHANGE_EVENT, listener, thisBinding);
		}

		/**
		* @name trigger
		* @desc trigger all listeners with the current state
		* @method
		* @instance
		* @fires CHANGE_EVENT
		* @memberof StateStore
		*/
		trigger(){
			this.emitter.emit(CHANGE_EVENT, this.state);
		}

		static get errors(){
			return {
				INVALID_DELTA: InvalidDeltaError,
				INVALID_RETURN: InvalidReturnError,
				INVALID_REDUCER: InvalidReducerError,
				INVALID_INDEX: InvalidIndexError
			};
		}
	}

	// polyfill
	Number.isInteger = Number.isInteger || function(value) {
		return typeof value === "number" &&
			isFinite(value) &&
			Math.floor(value) === value;
	};

};
