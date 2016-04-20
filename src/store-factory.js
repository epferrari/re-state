"use-strict";

const ActionFactory = require('./action-factory');
const {getter, defineProperty} = require('./utils');
const {ACTION} = require('./constants');

module.exports = function StateStoreFactory(Immutable, EventEmitter, _){

	const Action = ActionFactory(EventEmitter)

	// events
	const CHANGE_EVENT = 'STATE_CHANGE';
	const SET_EVENT = 'SET_INVOKED';
	const REDUCE_EVENT = 'REDUCE_INVOKED';
	const ACTION_ADDED = "ACTION_ADDED";

	function StateStore(initialState){
		var $$history,
				$$index,
				$$reducers,
				emitter,
				resolveDelta,
				resolveReducer,
				queueReduceCycle,
				executeReduceCycle,
				undo;

		if(typeof initialState !== 'undefined' && !_.isPlainObject(initialState))
			throw new Error(StateStore.errors.INVALID_DELTA);

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
		getter(this,'state', () => Immutable.Map($$history[$$index].$state).toJS() );
		getter(this, 'reducers', () => $$reducers.toJS() );

		undo = function undo(index){
			let lastHistory = $$history[index - 1];

			if($$history[index].reducer_invoked == 0)
				return // this state modification was already rendered moot

			// duplicate the history state at cachedIndex as if action was never called
			$$history[index] = {
				reducer_invoked: 0,
				delta: {},
				$state: lastHistory.$state
			}

			// revise subsequent history entries according to revised state at targetIndex
			$$history
			.slice(index)
			.reduce((last, curr, i) => {
				let reducerToApply = this.reducers[curr.reducer_invoked];
				let revisedState = reducerToApply.$invoke(last.$state.toJS(), curr.delta);
				let revisedHistory = {
					reducer_invoked: curr.reducer_invoked,
					delta: curr.delta,
					$state: last.$state.merge(revisedState)
				}
				// revise the entry
				$$history[index + i] = revisedHistory;
				return revisedHistory;
			}, lastHistory);

			this.trigger();
		}.bind(this);


		resolveDelta = function resolveDelta(lastState, delta, reducer, callToken){
			let resolvedState = reducer.$invoke(lastState, delta, undo.bind(this, ($$index + 1)), callToken);

			if( !_.isPlainObject(resolvedState) ) {
					throw new Error(StateStore.errors.INVALID_RETURN);
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

		/**
		*
		* @name listenTo
		* @param {function} reducer - created with `new Restate.Action(<reducer_function>)`
		* @param {string} strategy - one of ['compound', 'lead', 'tail']
		* @desc execute a reduce cycle when this function is called with a deltaMap
		*/
		this.listenTo = function listenTo(reducer, strategy){
			if((reducer.$$type == ACTION)){
				let index = $$reducers.size;

				// only add each Action once
				if(!_.contains($$reducers.toJS(), reducer)){
					$$reducers = $$reducers.push({
						$invoke: (lastState, delta, undoFn, token) => {
							/* maybe middleware here later */
							return reducer.$$invoke(lastState, delta, undoFn, token);
						},
						index: index,
						strategy: strategy,
						calls: []
					});

					// kick off a reduce cycle when the reducer action is called anywhere in the app
					let handler = (payload) => queueReduceCycle(index, payload.token, payload.delta);
					reducer.$$register(handler);

					let registration = {action: reducer.$$name, index: index}
					emitter.emit(ACTION_ADDED, registration)
					return registration;
				}
			} else {
				throw new Error(StateStore.errors.INVALID_REDUCER);
			}
		}.bind(this);

		this.listenToMany = function listenToMany(reducers){
			return _.reduce(reducers, (acc, r) => {
				if(_.isArray(r)){
					acc[r.$$name] = this.listenTo(r[0], r[1]);
				}else{
					acc[r.$$name] = this.listenTo(r)
				}
				return acc;
			}, {});
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
				throw new Error(StateStore.errors.INVALID_DELTA);
			} else {
				stateSetter(deltaMap);
			}
		};


		/**
		*
		* @name getImmutableState
		* @desc Get the current state as an Immutable Map
		* @instance
		* @memberof StateStore
		* @returns Immutable.Map
		*/
		this.getImmutableState = function getImmutableState(){
			return Immutable.Map( $$history[$$index]);
		};


		/**
		*
		* @name getInitialState
		* @desc Get the initial app state that was passed to the constructor
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		this.getInitialState = function getInitialState(){
			return $$history[0].$state.toJS();
		};


		/**
		*
		* @name getStateAtVersion
		* @desc Get the app's state at a version in the state $$history
		* @param {int} index
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		this.getStateAtVersion = function getStateAtVersion(index){
			if($$history[index])
				return $$history[index].toJS();
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
			var _initialState = this.getInitialState();
			if(force === true){
				// hard reset, clears the entire $$history stack, no previous histories are saved
				$$history = [Immutable.Map(_initialState)];
				$$index = 0;
			}else{
				// soft reset, push the initial state to the end of the $$history stack
				$$history.push(Immutable.Map(_initialState));
				$$index++;
			}

			this.trigger()

			return this.state;
		};


		/**
		*
		* @name rewind
		* @desc rewind the app $$history n versions. If `n` is greater than length of
		*   $$history stack, $$history will rewind to initial state. If `n` is less than
		*   zero, no rewind will occur. Triggers a change event.
		* @param {int} n - number of versions back to go
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		this.rewind = function rewind(n){
			if(n < 0) n = 0;
			var target = $$index - n;
			if(target > 0){
				$$index = target;
				this.trigger()
			}

			return this.state;
		};

		/**
		*
		* @name canUndo
		* @desc can an undo operation be performed on the state?
		* @instance
		* @memberof StateStore
		* @returns {boolean}
		*/
		Object.defineProperty(this,'canUndo', function canUndo(){
			return ($$index > 0);
		});


		/**
		*
		* @name canRedo
		* @desc can a redo operation be performed on the state?
		* @instance
		* @memberof StateStore
		* @returns {boolean}
		*/
		getter(this,'canRedo', function canRedo(){
			return $$index !== ($$history.length - 1);
		});

		/**
		*
		* @name undo
		* @desc If possible, move the $$history stack's HEAD back one version.
		*   Triggers a change event.
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		this.undo = function undo(){
			if(this.canUndo){
				$$index = $$index - 1;
				this.trigger()
			}
			return this.state;
		};

		/**
		*
		* @name redo
		* @desc If possible, move the $$history stack's HEAD ahead one version.
		*   Triggers a change event.
		* @instance
		* @memberof StateStore
		* @returns {object} state
		*/
		this.redo = function redo(){
			if(this.canRedo){
				$$index++;
				this.trigger()
			}
			return this.state;
		};

		this.getIndex = function getIndex(){
			return $$index;
		};
	}


	StateStore.prototype = {
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
		},

		/**
		* @name trigger
		* @desc alert all listeners with the current state
		* @instance
		* @memberof StateStore
		*/
		trigger(){
			this.emitter.emit(CHANGE_EVENT, this.state);
		}
	}



	/* ------- Static --------- */

	const errors = {};
	getter( errors, 'INVALID_DELTA', () => "a deltaMap passed to reducer as new state must be an object literal" );
	getter( errors, 'INVALID_RETURN', () => "a reducer must return an object literal to reduce into state" );
	getter( errors, 'INVALID_REDUCER' , () => "a reducer must be created by the Action factory with `new ReState.Action(<reducer>)`");
	getter(StateStore, 'errors', () => errors );



	// return constructor
	return StateStore;

};
