"use-strict";

import Immutable from 'immutable';
import _ from 'lodash';

import restate from '../src/restate';

const {Store, Action} = restate(Immutable, _);


describe("State Store", () => {
	var store, tick;

	beforeEach(() => {
		jasmine.clock().install()
		tick = (cb) => setTimeout(cb, 0);
	});

	afterEach(jasmine.clock().uninstall)

	describe("constructor", () => {
		it("initializes with an `immutable` state", () => {
			store = new Store({
				rabbit: "MQ"
			});
			expect(() => {
				return store.state = {
					rabbit: "stew"
				};
			}).toThrow();
			expect(store.state.rabbit).toEqual("MQ");
		});

		it("initializes with an `immutable` emitter property", () => {
			store = new Store();
			expect(store.emitter).toBeDefined();
			expect(() => {
				return store.emitter = true;
			}).toThrow();
		});

		it("initializes with an immutable `reducers` property", () => {
			store = new Store();
			expect(store.reducers).toBeDefined();
			expect( () => { store.reducers = []} ).toThrow();
		});

		it("adds 3 initial reducers, a noop and a setState, and a replaceState reducer",() => {
			store = new Store();
			expect(store.reducers.length).toEqual(3);
		});

		describe("when called with no arguments", () => {
			it("initializes an empty state object", () => {
				store = new Store();
				expect(store.state).toEqual({});
			});
		});

		describe("when called with an object argument", () => {
			it("initializes with an initial state", () => {
				store = new Store({
					rabbit: "MQ"
				});
				return expect(store.state).toEqual({
					rabbit: "MQ"
				});
			});
		});

		describe("when initialized with a non-object initial state", () => {
			it("throws an error", () => {
				let storeCreator = () => {
					return new Store("Roger Rabbit");
				};
				expect(storeCreator).toThrow( new Store.errors.INVALID_DELTA() );
			});
		});
	});

	describe("setState()", () => {
		var stateSetter;
		beforeEach(() => {
			store = new Store();
			stateSetter = store.reducers[1];
			spyOn(stateSetter, '$invoke').and.callThrough();

		});

		it("defers setting state until next tick", () => {
			expect(store.state).toEqual({});

			store.setState({ rabbit: "MQ" });

			expect(stateSetter.$invoke).not.toHaveBeenCalled();
			expect(store.state).toEqual({});

			jasmine.clock().tick(0)

			expect(stateSetter.$invoke).toHaveBeenCalled();
			expect(store.state).toEqual({ rabbit: "MQ" });
		});

		describe("when called with a non-object delta", () => {
			it("setState throws an error", () => {
				let setter;

				setter = () => {
					store.setState("egg basket");
					jasmine.clock().tick(0)
				};
				expect(setter).toThrow( new Store.errors.INVALID_DELTA() );

				setter = () => {
					store.setState(1);
					jasmine.clock().tick(0)
				};
				expect(setter).toThrow( new Store.errors.INVALID_DELTA() );

				setter = () => {
					store.setState(true);
					jasmine.clock().tick(0)
				};
				expect(setter).toThrow( new Store.errors.INVALID_DELTA() );

				setter = () => {
					store.setState(() => true)
					jasmine.clock().tick(0)
				}
				expect(setter).toThrow( new Store.errors.INVALID_DELTA() );
			});
		});

		describe("consolidating state updates", () => {
			beforeEach(() => {
				spyOn(store, 'trigger');
				expect(store.state).toEqual({});

				store.setState({ rabbit: "MQ" });
				store.setState({ rabbit: "stew" });
				store.setState({ rabbit: "foot" });
				store.setState({ rabbit: "Roger" });
			});

			it("consolidates state updates until the callstack clears", () => {
				expect(store.state).toEqual({});
				jasmine.clock().tick(0);
				expect(store.state).toEqual({ rabbit: "Roger" });
			});

			it("only calls trigger once per tick", () => {
				expect(store.trigger).not.toHaveBeenCalled();
				jasmine.clock().tick(0);
				expect(store.trigger).toHaveBeenCalledTimes(1);
			});

			it("does not call trigger if the state has not changed (test 1)", () => {
				expect(store.trigger).not.toHaveBeenCalled();
				jasmine.clock().tick(0);
				expect(store.trigger).toHaveBeenCalledTimes(1);
				store.trigger.calls.reset();
				store.setState(store.state);
				jasmine.clock().tick(0);
				expect(store.trigger).not.toHaveBeenCalled();
			});

			it("does not call trigger if the state has not changed (test 2)", () => {
				expect(store.trigger).not.toHaveBeenCalled();
				jasmine.clock().tick(0);
				expect(store.trigger).toHaveBeenCalledTimes(1);
				store.trigger.calls.reset();
				store.setState({rabbit: "Roger"});
				jasmine.clock().tick(0);
				expect(store.trigger).not.toHaveBeenCalled();
			});
		});

		describe("when the changes to state are nested deeply", () => {
			let rabbit1, rabbit2;

			beforeEach(() => {
				rabbit1 = {
					name: "Peter Cottontail",
					home: {city: "McGregor's garden"}
				};
				rabbit2 = {
					name: "Frank",
					home: {
						city: "Middlesex",
						state: "VA"
					}};

				store = new Store( {rabbits: [rabbit1, rabbit2]} );
			});

			it("changes the nested state and calls trigger", () => {
				let rabbit1_b = _.clone(rabbit1);
				rabbit1_b.home.state = "Connecticut";
				store.setState({
					rabbits: [ rabbit1_b, rabbit2 ]
				});
				jasmine.clock().tick(0);
				expect(store.state.rabbits[0].home.state).toBe("Connecticut");
				expect(store.state.rabbits[1]).toBeDefined();
			});

			it("merges multiple changes to the same object", () => {
				let rabbit1_b = _.merge({}, rabbit1);
				let rabbit1_c = _.merge({}, rabbit1);

				rabbit1_b.home.state = "Connecticut";
				expect(rabbit1_b).not.toEqual(rabbit1);

				store.setState({
					rabbits: [ rabbit1_b, rabbit2 ]
				});

				rabbit1_c.home.city = "Hartford";
				expect(rabbit1_c).not.toEqual(rabbit1_b);

				store.setState({
					rabbits: [rabbit1_c, rabbit2]
				});

				let lastStateRabbit1 = store.state.rabbits[0];
				expect(lastStateRabbit1.home.state).toBeUndefined();
				expect(lastStateRabbit1.home.city).toBe("McGregor's garden");

				jasmine.clock().tick(0);

				let newStateRabbit1 = store.state.rabbits[0];
				expect(newStateRabbit1.home.state).toBe("Connecticut");
				expect(newStateRabbit1.home.city).toBe("Hartford");
			});

			it("unsets a value with the '$unset' keyword", () => {
				expect(store.state.rabbits).toEqual([rabbit1, rabbit2]);
				store.setState({rabbits: "$unset"});

				jasmine.clock().tick(0);
				expect(store.state.rabbits).toBeUndefined();
			});

			it("unsets deeply", () => {
				expect(store.state.rabbits).toEqual([rabbit1, rabbit2]);
				expect(store.state.rabbits[0].home).toEqual({city: "McGregor's garden"})

				let rabbit1_b = _.merge({}, rabbit1);
				rabbit1_b.home = "$unset";
				store.setState({rabbits: [rabbit1_b, rabbit2]});

				jasmine.clock().tick(0);
				expect(store.state.rabbits[0].home).toBeUndefined();
			});
		});
	});

	describe("resetting state", () => {
		beforeEach(() => {
			store = new Store({rabbit: "MQ"});
		});

		describe("soft reset", () => {
			it("resets the state to initial state and adds it to history stack", () => {
				expect(store.versions).toEqual(1);
				store.setState({rabbit: "Roger"});
				store.setState({bunnies: ["Easter", "Bugs"]});

				jasmine.clock().tick(0);
				expect(store.versions).toEqual(3);
				expect(store.state.rabbit).toEqual('Roger');
				expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

				store.reset();

				jasmine.clock().tick(0);
				expect(store.versions).toEqual(4);
				expect(store.state.rabbit).toEqual("MQ");
				expect(store.state.bunnies).toBeUndefined();
			});

			it("recalculates state correctly with reset when a previous action is undone", () => {
				let addThing = new Action((lastState, thing) => {
					let things = lastState.things || [];
					things.push(thing);
					return {things};
				});

				store.listenTo(addThing, Action.strategies.COMPOUND);

				let undoAddThingA = addThing("A");
				addThing("B");
				addThing("C");

				jasmine.clock().tick(0);
				expect(store.state).toEqual({rabbit: "MQ", things: ["A","B","C"]});

				store.reset();

				jasmine.clock().tick(0);
				expect(store.state).toEqual({rabbit: "MQ"});

				undoAddThingA();
				expect(store.state).toEqual({rabbit: "MQ"});
			});
		});

		describe("hard reset", () => {
			it("hard resets the state to initial state and resets the history stack", () => {
				expect(store.versions).toEqual(1);
				store.setState({rabbit: "Roger"});
				store.setState({bunnies: ["Easter", "Bugs"]});

				jasmine.clock().tick(0);
				expect(store.versions).toEqual(3);
				expect(store.state.rabbit).toEqual('Roger');
				expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

				store.reset(true);

				jasmine.clock().tick(0);
				expect(store.versions).toEqual(1);
				expect(store.state.rabbit).toEqual("MQ");
				expect(store.state.bunnies).toBeUndefined();
			});
		});
	});

	describe("replaceState", () => {
		beforeEach(() => {
			store = new Store({rabbit: "MQ"});
		});

		it("replaces the state with a new state object", () => {
			store.replaceState({bunny: "Bugs"});

			jasmine.clock().tick(0);
			expect(store.state).toEqual({bunny: "Bugs"});
		});
	});


	describe("getInitialState()", () =>{
		beforeEach(() =>{
			store = new Store({rabbit: "MQ"});
		});

		it("returns the initial data state", () =>{
			expect(store.getInitialState()).toEqual({rabbit: "MQ"});

			store.setState({rabbit: "Roger"});
			jasmine.clock().tick(0)

			expect(store.state.rabbit).toBe("Roger");
			expect(store.getInitialState()).toEqual({rabbit: "MQ"});
		});
	});


	describe("transforming state through actions", () => {
		let addItem, removeItem, clearCart, updatePrice, checkout;

		// set up some basic actions
		beforeEach(() => {
			store = new Store({
				cart: [],
				priceList: {0: .25, 1: .50, 2: .75, 3: 0}
			});

			spyOn(store, 'trigger');

			let findById = (id, items) => {
				return _.find(items, item => {
					return (item.id === id);
				});
			};

			let getPrice = (id) => store.state.priceList[id] || 0

			// add item to the cart
			addItem = new Action('addItem', (lastState, id) => {
				let {cart} = lastState;
				let itemInCart = findById(id, cart);
				let itemIndex = cart.indexOf(itemInCart);

				if(itemInCart){
					itemInCart.qty++;
					cart[itemIndex] = itemInCart;
				}else{
					cart.push({ id: id, qty: 1});
				}

				return {cart: cart};
			});

			// remove item from cart
			removeItem = new Action('removeItem', (lastState, id) => {
				let {cart} = lastState;
				let itemInCart = findById(id, cart);
				let itemIndex = cart.indexOf(itemInCart);

				if(itemInCart){
					itemInCart.qty--;
					itemInCart.qty = Math.max(itemInCart.qty, 0)
					cart[itemIndex] = itemInCart;
				}
				return {cart: cart};
			});

			updatePrice = new Action('updatePrice', (lastState, deltaMap) => {
				let {priceList} = lastState.priceList;
				priceList[deltaMap.id] = deltaMap.price;
				return {priceList: priceList};
			});

			clearCart = new Action('clearCart', (lastState, deltaMap) => {
				let {cart} = lastState;
				items = _.map(cart, item => {
					item.qty = 0;
					return item;
				});
				return {cart: items};
			});

			checkout = new Action('checkout', (lastState, deltaMap) => {
				let total = lastState.cart.reduce((subTotal, item) => {
					return subTotal + (getPrice(item.id) * item.qty);
				}, 0)
				return {total: total}
			});
		});

		describe("with a single Action reducer", () => {
			describe("using Action's returned undo/redo functions", () => {
				beforeEach(() => {
					store.listenTo(addItem);
				});

				it("undoes the action's effect on state", () => {
					let undoAdd = addItem(0);
					expect(store.trigger).not.toHaveBeenCalled()

					jasmine.clock().tick(0);
					expect(store.state.cart).toEqual([{id:0, qty:1}]);
					expect(store.trigger).toHaveBeenCalledTimes(1)

					let redoAdd = undoAdd()
					expect(store.state.cart).toEqual([]);
					expect(store.trigger).toHaveBeenCalledTimes(2)

					let undoRedo = redoAdd()
					expect(store.state.cart).toEqual([{id:0, qty:1}]);
					expect(store.trigger).toHaveBeenCalledTimes(3)

					undoRedo()
					expect(store.state.cart).toEqual([]);
					expect(store.trigger).toHaveBeenCalledTimes(4)
				});

				it("does not add or remove states from the history", () => {
					expect(store.versions).toBe(1);

					let undoAdd = addItem(0);
					jasmine.clock().tick(0);

					expect(store.trigger).toHaveBeenCalledTimes(1)
					expect(store.versions).toBe(2)

					let redoAdd = undoAdd()
					expect(store.trigger).toHaveBeenCalledTimes(2)
					expect(store.versions).toBe(2)
				})
			});

			describe("using the `TAIL` strategy (Action.strategies.TAIL)", () => {
				beforeEach(() => {
					store.listenTo(addItem, 'TAIL');
				});

				it("updates the state from the last call to reducer", () => {
					expect(store.state.cart).toEqual([]);
					addItem(0);
					addItem(2);
					addItem(1);

					jasmine.clock().tick(0);
					expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
				});

				describe("undoing with `TAIL` strategy", () => {
					it("sets the state back to before the last action was called", () => {
						expect(store.state.cart).toEqual([]);
						let undoAdd = addItem(0);

						jasmine.clock().tick(0);
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

						undoAdd();
						expect(store.state.cart).toEqual([]);
					});

					it("does not update the state for reducer actions that were discarded by the tailing strategy", () => {
						let undoAdd0 = addItem(0);
						let undoAdd2 = addItem(2);
						let undoAdd1 = addItem(1);

						jasmine.clock().tick(0);
						expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
						expect(store.trigger).toHaveBeenCalledTimes(1);
						store.trigger.calls.reset();

						undoAdd0();
						expect(store.trigger).not.toHaveBeenCalled();
						expect(store.state.cart).toEqual([{id: 1, qty: 1}]);

						undoAdd2();
						expect(store.trigger).not.toHaveBeenCalled();
						expect(store.state.cart).toEqual([{id: 1, qty: 1}]);

						undoAdd1();
						expect(store.trigger).toHaveBeenCalledTimes(1);
						expect(store.state.cart).toEqual([]);
					});
				});
			});

			describe("using the `HEAD` strategy (Action.strategies.HEAD)", () => {
				beforeEach(() => store.listenTo(addItem, 'HEAD'));

				it("updates the state from the first call to reducer action", () => {
					expect(store.state.cart).toEqual([]);
					addItem(0);
					addItem(2);
					addItem(1);

					jasmine.clock().tick(0);
					expect(store.state.cart).toEqual([{id: 0, qty: 1}]);
				});

				describe("undoing with `HEAD` strategy", () => {
					it("sets the state back to before the first action was called", () => {
						expect(store.state.cart).toEqual([]);
						let undoAdd = addItem(0);

						jasmine.clock().tick(0);
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

						undoAdd();
						expect(store.state.cart).toEqual([]);
					});

					it("does not update the state for reducer actions that were discarded by the head strategy", () => {
						let undoAdd0 = addItem(0);
						let undoAdd2 = addItem(2);
						let undoAdd1 = addItem(1);

						let $addItem = store.reducers[3];
						spyOn($addItem, '$invoke').and.callThrough()

						jasmine.clock().tick(0);

						expect($addItem.$invoke).toHaveBeenCalledTimes(1);
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);
						expect(store.trigger).toHaveBeenCalledTimes(1);
						store.trigger.calls.reset();

						undoAdd1();
						expect(store.trigger).not.toHaveBeenCalled();
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

						undoAdd2();
						expect(store.trigger).not.toHaveBeenCalled();
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

						undoAdd0();
						expect(store.trigger).toHaveBeenCalledTimes(1);
						expect(store.state.cart).toEqual([]);
					});
				});
			});

			describe("using the `COMPOUND` strategy (Action.strategies.COMPOUND)", () => {
				beforeEach(() => store.listenTo(addItem, 'COMPOUND'));

				it("updates the state with all results of reducer action", () => {
					expect(store.state.cart).toEqual([]);

					addItem(0);
					addItem(1);
					addItem(2);
					addItem(0);
					addItem(2);

					jasmine.clock().tick(0);

					expect(store.trigger).toHaveBeenCalledTimes(1);
					expect(store.state.cart.length).toEqual(3);

					expect(store.state.cart[0]).toEqual({id: 0, qty: 2});
					expect(store.state.cart[1]).toEqual({id: 1, qty: 1});
					expect(store.state.cart[2]).toEqual({id: 2, qty: 2});
				});

				describe("undoing with `COMPOUND` strategy", () => {
					it("resets the state to before X action was called", () => {
						expect(store.state.cart).toEqual([]);
						let undoAdd1 = addItem(0);
						let undoAdd2 = addItem(0);
						let undoAdd3 = addItem(0);

						jasmine.clock().tick(0);
						expect(store.state.cart).toEqual([{id: 0, qty: 3}]);

						undoAdd3();
						expect(store.state.cart).toEqual([{id: 0, qty: 2}]);

						undoAdd2();
						expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

						undoAdd1();
						expect(store.state.cart).toEqual([])
					});

					it("noops the undo function once it is called", () =>{
						expect(store.state.cart).toEqual([]);
						let undoAdd1 = addItem(0);

						jasmine.clock().tick(0);
						expect(store.trigger).toHaveBeenCalledTimes(1);
						expect(store.state.cart).toEqual([{id:0, qty: 1}]);

						undoAdd1()
						expect(store.trigger).toHaveBeenCalledTimes(2);
						expect(store.state.cart).toEqual([])

						undoAdd1()
						expect(store.trigger).toHaveBeenCalledTimes(2);
					});

					it("leaves rest of state transformations intact", () =>{
						expect(store.state.cart).toEqual([]);
						let undoAdd0 = addItem(0);
						let undoAdd2 = addItem(2);
						let undoAdd1 = addItem(1);
						addItem(2);

						jasmine.clock().tick(0);
						expect(store.trigger).toHaveBeenCalledTimes(1);
						expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 2, qty: 2}, {id: 1, qty: 1}]);

						undoAdd2()
						expect(store.trigger).toHaveBeenCalledTimes(2);
						// notice that id:2 is now at the end. When history states were revised,
						// 2 was pushed by the last call to addItem because it's as if the first call with id:2 never happened
						expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}])

						let redoAdd0 = undoAdd0()
						expect(store.trigger).toHaveBeenCalledTimes(3);
						expect(store.state.cart).toEqual([{id: 1, qty: 1}, {id: 2, qty: 1}])

						redoAdd0()
						expect(store.trigger).toHaveBeenCalledTimes(4);
						expect(store.state.cart).toEqual([{id: 0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}])
					});
				});
			});
		});

		describe("when multiple reducers are registered with a store", () => {
			beforeEach(() => {
				spyOn(addItem, '$$invoke').and.callThrough()
				spyOn(removeItem, '$$invoke').and.callThrough()
				spyOn(clearCart, '$$invoke').and.callThrough()
				spyOn(checkout, '$$invoke').and.callThrough()

				store.listenTo(addItem, 'compound')
				store.listenTo(removeItem, 'compound')
				store.listenTo(clearCart)
				store.listenTo(checkout)
			});

			it("invokes only the actions triggered in each reduce cycle", () => {
				removeItem(0)
				removeItem(0)
				checkout()

				jasmine.clock().tick(0)
				expect(addItem.$$invoke).not.toHaveBeenCalled()
				expect(removeItem.$$invoke).toHaveBeenCalled()
				expect(clearCart.$$invoke).not.toHaveBeenCalled()
				expect(checkout.$$invoke).toHaveBeenCalled()
			});

			it("transforms state by invoking the reducers in the order they were listened to", () => {
				checkout()
				removeItem(1);
				addItem(1);
				addItem(1);
				addItem(1);

				jasmine.clock().tick(0);
				expect(store.state.cart).toEqual([{id: 1, qty: 2}])
				expect(store.state.total).toEqual(1.0);
			});
		});
	});
});
/*
		xdescribe("undoing when reducers rely on each other", () => {
			beforeEach(() => {
				store.listenTo(addItem);
				store.listenTo(removeItem);
				store.listenTo(bundle3with1when2isInCart);
				store.listenTo(checkout);
			});

			it("undoes state correctly (better it title needed!)", () => {
				addItem(1)
				addItem(2)
				checkout()
				addItem(1)
				removeItem(2)
			});
		});
*/
