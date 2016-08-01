import Promise from 'bluebird';
import {Store, Action} from '../src';
import _ from 'lodash';

describe("transforming state through actions", () => {
  let store,
    addItem, onAddItem,
    removeItem, onRemoveItem,
    clearCart, onClearCart,
    updatePrice, onUpdatePrice,
    checkout, onCheckout,
    tick;

  // set up some basic actions
  beforeEach(() => {
    jasmine.clock().install()
    tick = () => jasmine.clock().tick(0)

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
    addItem = new Action('addItem');
    onAddItem = (lastState, id) => {
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
    };

    // remove item from cart
    removeItem = new Action('removeItem');
    onRemoveItem = (lastState, id) => {
      let {cart} = lastState;
      let itemInCart = findById(id, cart);
      let itemIndex = cart.indexOf(itemInCart);

      if(itemInCart){
        itemInCart.qty--;
        itemInCart.qty = Math.max(itemInCart.qty, 0)
        cart[itemIndex] = itemInCart;
      }
      return {cart: cart};
    };

    updatePrice = new Action('updatePrice');
    onUpdatePrice = (lastState, newPriceRecord) => {
      let {priceList} = lastState.priceList;
      priceList[newPriceRecord.id] = newPriceRecord.price;
      return {priceList: priceList};
    };

    clearCart = new Action('clearCart');
    onClearCart = (lastState) => {
      let {cart} = lastState;
      items = _.map(cart, item => {
        item.qty = 0;
        return item;
      });
      return {cart: items};
    };

    checkout = new Action('checkout');
    onCheckout = (lastState) => {
      let total = lastState.cart.reduce((subTotal, item) => {
        return subTotal + (getPrice(item.id) * item.qty);
      }, 0)
      return {total: total}
    };
  });

  afterEach(() => jasmine.clock().uninstall())

  describe("with a single Action reducer", () => {
    describe("using Action's returned undo/redo functions", () => {
      beforeEach(() => {
        store.on(addItem, onAddItem)
      });

      it("undoes the action's effect on state", () => {
        let undoAdd = addItem(0)
        expect(store.trigger).not.toHaveBeenCalled()

        tick()
        expect(store.state.cart).toEqual([{id:0, qty:1}])
        expect(store.trigger).toHaveBeenCalledTimes(1)

        let redoAdd = undoAdd()
        tick()
        expect(store.state.cart).toEqual([]);
        expect(store.trigger).toHaveBeenCalledTimes(2)

        let undoRedo = redoAdd()
        tick()
        expect(store.state.cart).toEqual([{id:0, qty:1}])
        expect(store.trigger).toHaveBeenCalledTimes(3)

        undoRedo()
        tick()
        expect(store.state.cart).toEqual([])
        expect(store.trigger).toHaveBeenCalledTimes(4)
      });

      it("does not add or remove states from the history", () => {
        expect(store.depth).toBe(1)

        let undoAdd = addItem(0)
        tick()

        expect(store.trigger).toHaveBeenCalledTimes(1)
        expect(store.depth).toBe(2)

        let redoAdd = undoAdd()
        tick()
        expect(store.trigger).toHaveBeenCalledTimes(2)
        expect(store.depth).toBe(2)
      });

      it("executes asyncronously", () => {
        let undoAdd = addItem(0);
        expect(store.trigger).not.toHaveBeenCalled()
        expect(store.state.cart).toEqual([])

        undoAdd()
        expect(store.trigger).not.toHaveBeenCalled()
        expect(store.state.cart).toEqual([])

        tick()
        expect(store.trigger).toHaveBeenCalledTimes(1)
        expect(store.state.cart).toEqual([])
      });

      describe("when the action is undone before next tick", () => {
        it("still pushes a state to history", () => {
          expect(store.depth).toBe(1)
          let undoAdd = addItem(0)
          undoAdd()
          tick()
          expect(store.depth).toBe(2)
        });

        it("can be redone and correctly apply state", () => {
          let undoAdd = addItem(1)
          let redoAdd = undoAdd()

          tick()
          expect(store.state.cart).toEqual([])

          redoAdd()
          tick()
          expect(store.state.cart).toEqual([{id: 1, qty: 1}])
        });
      });
    });

    describe("using the `TAIL` strategy (Action.strategies.TAIL)", () => {
      beforeEach(() => {
        store.on(addItem, onAddItem, 'TAIL');
      });

      it("updates the state from the last call to reducer", () => {
        expect(store.state.cart).toEqual([])
        addItem(0)
        addItem(2)
        addItem(1)

        tick()
        expect(store.state.cart).toEqual([{id: 1, qty: 1}])
      });

      describe("undoing with `TAIL` strategy", () => {
        it("sets the state back to before the last action was called", () => {
          expect(store.state.cart).toEqual([])
          let undoAdd = addItem(0)

          tick()
          expect(store.state.cart).toEqual([{id: 0, qty: 1}])

          undoAdd()
          tick()
          expect(store.state.cart).toEqual([])
        });

        it("does not update the state for reducer actions that were discarded by the tailing strategy", () => {
          let undoAdd0 = addItem(0)
          let undoAdd2 = addItem(2)
          let undoAdd1 = addItem(1)

          tick()
          expect(store.state.cart).toEqual([{id: 1, qty: 1}])
          expect(store.trigger).toHaveBeenCalledTimes(1)
          store.trigger.calls.reset()

          undoAdd0()
          tick()
          expect(store.trigger).not.toHaveBeenCalled()
          expect(store.state.cart).toEqual([{id: 1, qty: 1}])

          undoAdd2()
          tick()
          expect(store.trigger).not.toHaveBeenCalled()
          expect(store.state.cart).toEqual([{id: 1, qty: 1}])

          undoAdd1()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(1)
          expect(store.state.cart).toEqual([])
        });
      });
    });

    describe("using the `HEAD` strategy (Action.strategies.HEAD)", () => {
      beforeEach(() => store.on(addItem, onAddItem, 'HEAD'));

      it("updates the state from the first call to reducer action", () => {
        expect(store.state.cart).toEqual([]);
        addItem(0)
        addItem(2)
        addItem(1)

        tick()
        expect(store.state.cart).toEqual([{id: 0, qty: 1}])
      });

      describe("undoing with `HEAD` strategy", () => {
        it("sets the state back to before the first action was called", () => {
          expect(store.state.cart).toEqual([])
          let undoAdd = addItem(0)

          tick()
          expect(store.state.cart).toEqual([{id: 0, qty: 1}])

          undoAdd()
          tick()
          expect(store.state.cart).toEqual([])
        });

        it("does not update the state for reducer actions that were discarded by the head strategy", () => {
          let undoAdd0 = addItem(0);
          let undoAdd2 = addItem(2);
          let undoAdd1 = addItem(1);

          let $addItem = store.reducers[3];
          spyOn($addItem, 'invoke').and.callThrough()

          tick()

          expect($addItem.invoke).toHaveBeenCalledTimes(1);
          expect(store.state.cart).toEqual([{id: 0, qty: 1}]);
          expect(store.trigger).toHaveBeenCalledTimes(1);
          store.trigger.calls.reset();

          undoAdd1();
          tick()
          expect(store.trigger).not.toHaveBeenCalled();
          expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

          undoAdd2();
          tick()
          expect(store.trigger).not.toHaveBeenCalled();
          expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

          undoAdd0();
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(1);
          expect(store.state.cart).toEqual([]);
        });
      });
    });

    describe("using the `COMPOUND` strategy (Action.strategies.COMPOUND)", () => {
      beforeEach(() => store.on(addItem, onAddItem, 'COMPOUND'));

      it("updates the state with all results of reducer action", () => {
        expect(store.state.cart).toEqual([]);

        addItem(0);
        addItem(1);
        addItem(2);
        addItem(0);
        addItem(2);

        tick()

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

          tick()
          expect(store.state.cart).toEqual([{id: 0, qty: 3}]);

          undoAdd3();
          tick()
          expect(store.state.cart).toEqual([{id: 0, qty: 2}]);

          undoAdd2();
          tick()
          expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

          undoAdd1();
          tick()
          expect(store.state.cart).toEqual([])
        });

        it("noops the undo function once it is called", () =>{
          expect(store.state.cart).toEqual([]);
          let undoAdd1 = addItem(0);

          tick()
          expect(store.trigger).toHaveBeenCalledTimes(1);
          expect(store.state.cart).toEqual([{id:0, qty: 1}]);

          undoAdd1()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(2);
          expect(store.state.cart).toEqual([])

          undoAdd1()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(2);
        });

        it("leaves rest of state transformations intact", () =>{
          expect(store.state.cart).toEqual([]);
          let undoAdd0 = addItem(0);
          let undoAdd2 = addItem(2);
          let undoAdd1 = addItem(1);
          addItem(2);

          tick()
          expect(store.trigger).toHaveBeenCalledTimes(1);
          expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 2, qty: 2}, {id: 1, qty: 1}]);

          undoAdd2()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(2);
          // notice that id:2 is now at the end. When history states were revised,
          // 2 was pushed by the last call to addItem because it's as if the first call with id:2 never happened
          expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}])

          let redoAdd0 = undoAdd0()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(3);
          expect(store.state.cart).toEqual([{id: 1, qty: 1}, {id: 2, qty: 1}])

          redoAdd0()
          tick()
          expect(store.trigger).toHaveBeenCalledTimes(4);
          expect(store.state.cart).toEqual([{id: 0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}])
        });
      });
    });
  });

  describe("when multiple reducers are registered with a store", () => {
    beforeEach(() => {
      spyOn(addItem,    'didInvoke').and.callThrough()
      spyOn(removeItem, 'didInvoke').and.callThrough()
      spyOn(clearCart,  'didInvoke').and.callThrough()
      spyOn(checkout,   'didInvoke').and.callThrough()

      store.on(addItem, onAddItem, 'compound')
      store.on(removeItem, onRemoveItem, 'compound')
      store.on(clearCart, onClearCart)
      store.on(checkout, onCheckout)
    });

    it("invokes only the actions triggered in each reduce cycle", () => {
      removeItem(0)
      removeItem(0)
      checkout()

      tick()
      expect(addItem.didInvoke).not.toHaveBeenCalled()
      expect(removeItem.didInvoke).toHaveBeenCalled()
      expect(clearCart.didInvoke).not.toHaveBeenCalled()
      expect(checkout.didInvoke).toHaveBeenCalled()
    });

    it("transforms state by invoking the reducers in the order their actions were listened to", () => {
      checkout()
      removeItem(1);
      addItem(1);
      addItem(1);
      addItem(1);

      tick()
      expect(store.state.cart).toEqual([{id: 1, qty: 2}])
      expect(store.state.total).toEqual(1.0);
    });
  });

  describe("calling actions inside other actions' reducer", () => {
    it("throws an error", () => {
      let outerAction = new Action("someAction");
      let innerAction = new Action("innerAction");

      let handleOuterAction = (lastState, payload) => {
        innerAction(payload);
        return lastState;
      };

      let handleInnerAction = l => l;

      store.on([
        {action: outerAction, reducer: handleOuterAction},
        {action: innerAction, reducer: handleInnerAction}
      ]);

      let shouldThrow = () => {
        outerAction('uh-oh');
        tick();
      }
      expect(shouldThrow).toThrow()

    })
  })
});
