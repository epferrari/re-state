"use-strict";

const Action = require('./Action');
const {getter, defineProperty} = require('./utils');
const {ACTION} = require('./constants');
const EventEmitter = require('./EventEmitter');

module.exports = function StoreFactory(Immutable, _){

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
		constructor(initialState){
			var $$history,
					$$index,
					$$reducers,
					emitter,
					resolveDelta,
					resolveReducer,
					queueReduceCycle,
					executeReduceCycle,
					undo,
					rewriteHistory;

			if(typeof initialState !== 'undefined' && !_.isPlainObject(initialState))
				throw new InvalidDeltaError();

			// pointer to current state of $$history
			$$index = 0;

			// list of reducers invoked to change state
			$$reducers = Immutable.List();

			// private stack of [reducer index, Immutable Map app state]
			$$history = [{
				reducer_invoked: 0,
				delta: {},
				$state: Immutable.Map(initialState)
			}];

			emitter = new EventEmitter();

			getter(this, 'emitter', () => emitter );
			getter(this, 'state', () => Immutable.Map($$history[$$index].$state).toJS() );
			getter(this, 'reducers', () => $$reducers.toJS() );
			getter(this, 'length', () => $$history.length);
			getter(this, 'history', () => $$history);
			getter(this, 'index', () => $$index);

			undo = function undo(atIndex){
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
					$state: lastHistory.$state
				}

				// revise subsequent history entries according to revised state at targetIndex
				rewriteHistory(atIndex);

				// return a function to undo the undo
				return redo;

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
						$state: last.$state.merge(revisedState)
					}
					// revise the entry
					$$history[fromIndex + i] = revisedHistory;
					return revisedHistory;
				}, lastHistory);

				this.trigger();
			}.bind(this);

			resolveDelta = function resolveDelta(lastState, delta, reducer, callToken){
				let undoDelta = undo.bind(this, ($$index + 1));
				let resolvedState = reducer.$invoke(lastState, delta, undoDelta, callToken);

				if( !_.isPlainObject(resolvedState) ) {
						throw new InvalidReturnError()
				} else {
					// add a new state to the $$history and increment index
					// return state to the next reducer
					let newImmutableState = $$history[$$index].$state.merge(resolvedState);

					if(!Immutable.is($$history[$$index].$state, newImmutableState)){
						$$history = $$history.slice(0, $$index + 1);
						// add new entry to history
						$$history.push({
							reducer_invoked: reducer.index,
							delta: delta,
							$state: newImmutableState
						});
						// update the pointer to new state in $$history
						$$index++;
					}
					return resolvedState;
				}
			}.bind(this)

			resolveReducer = function resolveReducer(lastState, reducer){
				//if(!reducer.calls.length) return lastState;

				let c, last;

				switch((reducer.strategy || "").toLowerCase()){
					case (Action.strategies.COMPOUND.toLowerCase()):
						// reduce down all the deltas
						return reducer.calls.reduce((state, c) => {
							return resolveDelta(state, c.delta, reducer, c.token);
						}, lastState);
					case (Action.strategies.HEAD.toLowerCase()):
						// transform using the first delta queued
						c = reducer.calls[0];
						return resolveDelta(lastState, c.delta, reducer, c.token);
					case (Action.strategies.TAIL.toLowerCase()):
						// resolve using the last delta queued
						last = (reducer.calls.length - 1);
						c = reducer.calls[last];
						return resolveDelta(lastState, c.delta, reducer, c.token);
					default:
						// use tailing strategy
						last = (reducer.calls.length - 1);
						c = reducer.calls[last];
						return resolveDelta(lastState, c.delta, reducer, c.token);
				}
			}


			/**
			*
			* @desc reduce a series of new states from pending $$reducers
			* @private
			*/
			executeReduceCycle = function executeReduceCycle(previousState){
				this.emitter.emit(REDUCE_EVENT);
				let initialIndex = $$index;
				let maybeNewState = _($$reducers.toJS())
					.chain()
					.filter(reducer => reducer.calls.length)
					.sortBy(reducer => reducer.index)
					.reduce((state, reducer) => {

						// run the state through the reducer
						let newState = resolveReducer(state, reducer);

						// clear deltaMaps for the next cycle and create new immutable list
						$$reducers = $$reducers.update(reducer.index, r => {
							r.calls = [];
							return r;
						});

						return newState;
					}, _.merge({}, previousState) )
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
					reducer.calls.push({delta: delta, token: token});
					return reducer;
				});

				// defer a state reduction on the next tick if one isn't already queued
				if(!reducePending){
					reducePending = true;
					setTimeout(() => {
						reducePending = false;
						executeReduceCycle(this.state);
					}, 0);
				}
			}.bind(this);


			let listenToAction = function listenToAction(action, strategy){
				if((action.$$type == ACTION)){
					let index = $$reducers.size;

					let reducer = {
						$invoke: (lastState, delta, undoFn, token) => {
							/* maybe middleware here later */
							return action.$$invoke(lastState, delta, undoFn, token);
						},
						index: index,
						strategy: strategy,
						calls: []
					};

					// only add each Action once
					if(!_.contains($$reducers.toJS(), reducer)){
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
			* @param {function, array} actions - created with `new Restate.Action(<reducer_function>)`
			*   If passed an array, strategies can be defined like so: [{action: <Action>[, strategy: <strategy>]}].
			*   Object definitions and plain actions can be combined in the same array:
			*   `[<Action>, {action: <Action>, strategy: <strategy>}, <Action>]`
			* @param {string} strategy - one of ['compound', 'lead', 'tail']
			* @desc execute a reduce cycle when this function is called with a deltaMap
			*/
			this.listenTo = function listenTo(actions, strategy){
				if(_.isFunction(actions)){
					return listenToAction(actions, strategy);
				} else if(_.isArray(actions)){
					return actions.reduce((acc, action) => {
						if(_.isFunction(action)){
							// [<Action>, <Action>, ...]
							acc[action.$$name] = listenToAction(action);
						} else if(_.isPlainObject(action)){
							// [{action: <Action>[,strategy: <strategy>], ...}]
							acc[action.action.$$name] = listenToAction(action.action, action.strategy);
						}
						return acc;
					},{});
				}
			}.bind(this);

			// set the store's 0 index reducer as a noop
			let noop = new Action('no-op', (lastState) => lastState);
			this.listenTo(noop)

			// set the store's second reducer to handle direct setState operations
			let stateSetter = new Action('setState', (lastState, deltaMap) => {
				let newState = _.merge({}, lastState, deltaMap);
				return newState;
			});
			this.listenTo(stateSetter, Action.strategies.COMPOUND);

			/**
			*
			* @name setState
			* @desc Reduce an updated state on the next tick with a plain object. Emits `SET_STATE` event
			* @param {object} deltaMap - a state deltaMap to be reduced against and eventually merged into state
			* @instance
			* @memberof StateStore
			*/
			this.setState = function setState(deltaMap){
				if(!_.isPlainObject(deltaMap)){
					throw new InvalidDeltaError();
				} else {
					return stateSetter(deltaMap);
				}
			};

			/**
			*
			* @name reset
			* @desc Reset the app to it's original state. Triggers a change event
			* @param {boolean} force - delete state $$history
			* @instance
			* @memberof StateStore
			* @returns {object} state
			*/
			this.reset = function reset(force){
				if(force === true){
					// hard reset, clears the entire $$history stack, no previous histories are saved
					$$history = [$$history[0]];
					$$index = 0;
				} else {
					// soft reset, push the initial state to the end of the $$history stack
					$$history.push($$history[0]);
					$$index++;
				}

				this.trigger()

				return this.state;
			};

			this.resetToIndex = function resetTo(index){
				if(!Number.isInteger(index)){
					throw new InvalidIndexError();
				} else if(index >= 0 && index <= $$history.length -1){
					$$index = index;
					$$history = $$history.slice(0, $$index);
					this.trigger()
					return this.state;
				}
			}.bind(this);

			this.fastForward = function fastForward(n){
				if(n !== undefined && !Number.isInteger(n)){
					throw new InvalidIndexError();
				} else {
					n = (n || 1)
					// ensure we don't go past the end of history
					$$index = Math.min( ($$index + Math.abs(n)), ($$history.length - 1));
					this.trigger();
					return this.state;
				}
			}.bind(this);

			this.rewind = function rewind(n){
				if(n !== undefined && !Number.isInteger(n)){
					throw new InvalidIndexError();
				} else {
					n = (n || 1)
					// ensure we don't go past the beginning of time
					$$index = Math.max( ($$index - Math.abs(n)), 0)
					this.trigger();
					return this.state;
				}
			}.bind(this);

			this.goto = function goto(index){
				if(!Number.isInteger(n)){
					throw new InvalidIndexError();
				} else if(index >= 0 && index <= $$history.length -1){
					$$index = index;
					this.trigger();
				}
				return this.state;
			}.bind(this);
		}

		/**
		*
		* @name getImmutableState
		* @desc Get the current state as an Immutable Map
		* @instance
		* @memberof StateStore
		* @returns Immutable.Map
		*/
		getImmutableState(){
			return Immutable.Map(this.history[this.index].$state);
		}


		/**
		*
		* @name getInitialState
		* @desc Get the initial app state that was passed to the constructor
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
		* @returns an unlisten function for the listener
		* @instance
		* @memberof StateStore
		*/
		addListener(listener, thisBinding){
			return this.emitter.on(CHANGE_EVENT, listener, thisBinding);
		}

		/**
		* @name trigger
		* @desc trigger all listeners with the current state
		* @instance
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
