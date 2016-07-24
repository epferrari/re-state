"use-strict";

import Promise from 'bluebird';
import {Store, Action} from '../src/apheleia';
import _ from 'lodash';

/*
const waitFor = (predicate, cb, maxWait) => {
  let finish = () => {
    clearTimeout($to)
    clearInterval($int)
    cb()
  }

  let $int = setInterval(() => {
    if(predicate())
      finish()
  }, 5)
  let $to = setTimeout(finish, maxWait || 5000)
}

const waitsFor = (spec, done, maxWait) => {
  let finish = () => {
    clearTimeout($to)
    clearInterval($int)
    done()
  }

  let $int = setInterval(() => {
    try{
      spec()
      finish()
    }catch(ex){
      console.log("TRYING AGAIN")
    }
  }, 5)
  let $to = setTimeout(finish, maxWait || 5000)
}
*/

describe("State Store", () => {
  var store, tick;

  beforeEach(() => {
    jasmine.clock().install()
    tick = (cb, wait) => setTimeout(cb, wait);
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

    it("initializes with an immutable _emitter property", () => {
      store = new Store();
      expect(store._emitter).toBeDefined();
      expect(() => {
        return store._emitter = true;
      }).toThrow();
    });

    it("initializes with an immutable `reducers` property", () => {
      store = new Store();
      expect(store.reducers).toBeDefined();
      expect( () => { store.reducers = []} ).toThrow();
    });

    it("adds 3 initial reducers, a noOp and a setState, and a replaceState reducer",() => {
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

  describe("setState(delta)", () => {
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

  xdescribe("middleware", () => {
    let mw,
        callOrder = [],
        log = [],
        caughtExceptions = [],
        addItem,
        addExtraProps;

  // create some actions

    addItem = new Action('addItem', (lastState, id) => {
      let {cart} = lastState;
      let itemIndex = _.findIndex(cart, (item) => item.id === id);

      if(itemIndex !== -1)
        cart[itemIndex].qty++;
      else
        cart.push({id, qty: 1});

      return {cart};
    });

    addExtraProps = new Action('addExtraProps', (lastState, payload) => {
      return payload;
    });


  // create some middleware

    function handleExceptions(prev, next, meta){
      callOrder.push('handleExceptions')
      try {
        return next(prev())
      } catch(ex){
        caughtExceptions.push(ex)
      }
    }

    function handleAsyncActions(prev, next, meta){
      callOrder.push("handleAsyncActions")
      let delta = prev()
      if(typeof delta.then === 'function'){
        return delta.then(next)
      }else{
        return next(delta)
      }
    }

    function prune(prev, next, meta){
      callOrder.push('prune')
      return next(_.pick(prev(), ['cart', 'total']))
    }

    function logMeta(prev, next, meta){
      callOrder.push('logMeta');
      log.push(meta)
      return next(prev());
    }

    function calculateTotal(prev, next, meta){
      callOrder.push('calculateTotal');

      let prices = {
        "01": 0.50,
        "02": 0.75,
        "03": 1.25
      };
      let delta = prev();
      let {cart} = delta;

      if(cart){
        delta.total = cart.reduce((total, item) => {
          return total + (item.qty * prices[item.id]);
        }, 0);
      }
      return next(delta);
    }


    beforeEach(() => {
      caughtExceptions = [];
      log = [];
      callOrder = [];

      mw = {handleExceptions, handleAsyncActions, logMeta, prune, calculateTotal}

      spyOn(mw, "handleExceptions").and.callThrough()
      spyOn(mw, "handleAsyncActions").and.callThrough()
      spyOn(mw, "logMeta").and.callThrough()
      spyOn(mw, "prune").and.callThrough()
      spyOn(mw, "calculateTotal").and.callThrough()
    });

    // set up store with middleware and listening to actions
    beforeEach(done => {
      console.log('store 1', store)
      store = new Store(
        {cart: [], total: 0},
        [mw.handleExceptions, mw.handleAsyncActions, mw.logMeta, mw.prune, mw.calculateTotal]
      );

      store.listenTo([
        {action: addItem, strategy: 'compound'},
        addExtraProps
      ]);

      jasmine.clock().uninstall()
      done()
    });

    afterEach(() => jasmine.clock().install())

    describe("calling middleware", () => {
      beforeEach((done) => {
        addItem("01")
        setTimeout(done,50)
      })

      it("is called in the order the middleware was added to the store", () => {
        console.log('callOrder',callOrder)
        console.log('exceptions', caughtExceptions)
        expect(callOrder).toEqual([
          "handleExceptions",
          "handleAsyncActions",
          "logMeta",
          "prune",
          "calculateTotal"
        ])
      })
    })

    describe("handling an async action", () => {
      let asyncAddItem, resolver, resolved;

      beforeEach((done) => {
        resolved = undefined
        let asyncAddItem = new Action((lastState, payload) => {
          resolved = new Promise((resolve, reject) => {
            // reveal this externally so we can mock the async resolution
            let {cart} = lastState
            // making it simple, just add an item to the cart
            cart.push({id: payload, qty: 1})
            resolver = () => resolve({cart})
          })

          return resolved
        })

        store.listenTo(asyncAddItem)

        asyncAddItem("03")
        setTimeout(done, 25)
      })

      afterEach((done) => {
        setTimeout(() => {
          resolver = resolved = undefined
          done()
        },0)

      })

      it("should delay subsequent middleware exectution until the async action is resolved", (done) => {
        expect(callOrder).toEqual([
          "handleExceptions",
          "handleAsyncActions"
        ])

        resolver()

        let pred = () => {
          return (callOrder == [
            "handleExceptions",
            "handleAsyncActions",
            "logMeta",
            "prune",
            "calculateTotal"
          ])
        }

        let onSuccess = () => {
          expect(callOrder).toEqual([
            "handleExceptions",
            "handleAsyncActions",
            "logMeta",
            "prune",
            "calculateTotal"
          ])
        }
        waitsFor(onSuccess, done, 20)

        /*
        resolved.then(() => {
          done()
          expect(callOrder).toEqual([
            "handleExceptions",
            "handleAsyncActions",
            "logMeta",
            "prune",
            "calculateTotal"
          ])
        })
        */
      })

      it("delays updating the state history until the async action is resolved", (done) => {
        expect(store.state).toEqual({ cart: [], total: 0 })

        resolver()

        resolved.then(() => {
          done()
          expect(store.state).toEqual({ cart: [ { id: '03', qty: 1 } ], total: 1.25 })
        })
      })
    })



    describe("when there are multiple actions invoked", () => {
      it("gets called for every action that will update state history", (done) => {
        addItem("01")
        addItem("01")
        addItem("03")

				setTimeout(() => {
					expect(store.state).toEqual({
						cart:[
              {id: "01", qty: 2},
              {id: "03", qty: 1}
            ],
            total: 2.25
					})
					done()
				}, 50)
				/*
        waitsFor(() => {
          expect(store.state).toEqual({
            cart:[
              {id: "01", qty: 2},
              {id: "03", qty: 1}
            ],
            total: 2.25
          })
        }, done)
				*/
      })
    })


    it("operates on the new state before it gets merged into history", () => {
      addExtraProps({something: 'else'});

      jasmine.clock().tick(0)
      // expecting that the key 'something' got pruned before adding to history state
      expect(store.state.something).toBeUndefined()
    });

    describe("handling exceptions with middleware", () => {
      beforeEach(() => {
        spyOn(store, 'trigger');
        store.trigger.calls.reset();
        expect(caughtExceptions.length).toEqual(0);
      });

      it("can catch errors thrown inside actions", () => {
        let actionThatThrows = new Action('actionThatThrows', (lastState, payload) => {
          throw new Error('something went awry')
        });

        store.listenTo(actionThatThrows)
        actionThatThrows()

        jasmine.clock().tick(0)
        expect(caughtExceptions.length).toEqual(1)
        expect(store.trigger).not.toHaveBeenCalled()
      });

      it("can catch an error raised by a poorly written action which doesn't return an object literal", () => {
        // returns a string instead of a delta oject
        let poorlyWrittenAction = new Action('poorlyWrittenAction', (lastState, id) => {
          return "elephant";
        });

        store.listenTo(poorlyWrittenAction)

        poorlyWrittenAction();
        jasmine.clock().tick(0);

        expect(caughtExceptions.length).toEqual(1)
        expect(store.trigger).not.toHaveBeenCalled()
      });

      it("can catch an error raised by a poorly written middleware downstream", () => {
        mw.poorlyWrittenMiddleware = (next) => {
          next()
          return "not an object literal";
        }


        let otherStore = new Store({cart: [], total: 0}, [mw.handleException, mw.poorlyWrittenMiddleware])

        otherStore.listenTo(addItem);

        spyOn(otherStore, 'trigger');
        otherStore.trigger.calls.reset();

        expect(caughtExceptions.length).toEqual(0)
        addItem("O1");

        jasmine.clock().tick(0)
        expect(caughtExceptions.length).toEqual(1)
        expect(otherStore.trigger).not.toHaveBeenCalled()
      });
    });
  });

  describe("replaceState(newState)", () => {
    beforeEach(() => {
      store = new Store({rabbit: "MQ"});
    });

    it("replaces the state with a new state object", () => {
      store.replaceState({bunny: "Bugs"});

      jasmine.clock().tick(0);
      expect(store.state).toEqual({bunny: "Bugs"});
    });
  });

  describe("reset()", () => {
    let addThing;

    beforeEach(() => {
      store = new Store({rabbit: "MQ"});

      addThing = new Action((lastState, thing) => {
        let things = lastState.things || [];
        things.push(thing);
        return {things};
      });

      store.listenTo(addThing, Action.strategies.COMPOUND);
    });

    describe("soft reset", () => {
      it("resets the state to initial state and adds it to history stack", () => {
        expect(store.previousStates).toEqual(1);
        store.setState({rabbit: "Roger"});
        store.setState({bunnies: ["Easter", "Bugs"]});

        jasmine.clock().tick(0);

        expect(store.previousStates).toEqual(3);
        expect(store.state.rabbit).toEqual('Roger');
        expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

        store.reset();

        jasmine.clock().tick(0);

        expect(store.previousStates).toEqual(4);
        expect(store.state.rabbit).toEqual("MQ");
        expect(store.state.bunnies).toBeUndefined();
      });

      it("recalculates state correctly with reset when a previous action is undone", () => {
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
      it("resets the state to initial state and resets the history stack", () => {
        expect(store.previousStates).toEqual(1);
        store.setState({rabbit: "Roger"});
        store.setState({bunnies: ["Easter", "Bugs"]});

        jasmine.clock().tick(0);
        expect(store.previousStates).toEqual(3);
        expect(store.state.rabbit).toEqual('Roger');
        expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

        store.reset(true);

        jasmine.clock().tick(0);
        expect(store.previousStates).toEqual(1);
        expect(store.state.rabbit).toEqual("MQ");
        expect(store.state.bunnies).toBeUndefined();
      });

      it("nullifies undo functions returned from actions that reduced a now-deleted state history", () => {
        spyOn(store, 'trigger');

        let undoAddThingA = addThing("A"); // resolves to state 2
        addThing("B"); // resolves to state 3
        addThing("C"); // resolves to state 4

        expect(store.previousStates).toEqual(1);
        jasmine.clock().tick(0);
        expect(store.previousStates).toEqual(4);
        expect(store.state).toEqual({rabbit: "MQ", things: ["A","B","C"]});

        undoAddThingA();
        // calling undo on addThingA recalculates the state without the delta at version 2
        expect(store.state).toEqual({rabbit: "MQ", things: ["B","C"]});

        // hard reset the history, erasing state 2
        store.reset(true);

        jasmine.clock().tick(0);
        expect(store.previousStates).toEqual(1);
        expect(store.state).toEqual({rabbit: "MQ"});

        store.setState({bunny: "Bugs"}); // resolves to new state 2

        jasmine.clock().tick(0);
        expect(store.previousStates).toEqual(2);
        expect(store.state).toEqual({rabbit: "MQ", bunny: "Bugs"});

        store.trigger.calls.reset();
        undoAddThingA();

        expect(store.trigger).not.toHaveBeenCalled();
        // state 2 was not affected by the undo function that used to point there
        expect(store.state).toEqual({rabbit: "MQ", bunny: "Bugs"});
      });
    });
  });


  describe("resetToState(index)", () => {

  });


  describe("fastForward(n)", () => {

  });


  describe("rewind(n)", () => {

  });


  describe("goto(index)", () => {

  });


  describe("getImmutableState()", () => {

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


  describe("getStateAtIndex(index)", () => {

  });


  describe("addListener(listener, thisBinding)", () => {

  });


  describe("trigger()", () => {

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
          expect(store.previousStates).toBe(1);

          let undoAdd = addItem(0);
          jasmine.clock().tick(0);

          expect(store.trigger).toHaveBeenCalledTimes(1)
          expect(store.previousStates).toBe(2)

          let redoAdd = undoAdd()
          expect(store.trigger).toHaveBeenCalledTimes(2)
          expect(store.previousStates).toBe(2)
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
