import Promise from 'bluebird';
import {Store, Action} from '../src';
import _ from 'lodash';

describe("transforming state through actions", () => {
  let store, addItem, removeItem, clearCart, updatePrice, checkout;

  // set up some basic actions
  beforeEach(() => {
    jasmine.clock().install()

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

    updatePrice = new Action('updatePrice', (lastState, newPriceRecord) => {
      let {priceList} = lastState.priceList;
      priceList[newPriceRecord.id] = newPriceRecord.price;
      return {priceList: priceList};
    });

    clearCart = new Action('clearCart', (lastState) => {
      let {cart} = lastState;
      items = _.map(cart, item => {
        item.qty = 0;
        return item;
      });
      return {cart: items};
    });

    checkout = new Action('checkout', (lastState) => {
      let total = lastState.cart.reduce((subTotal, item) => {
        return subTotal + (getPrice(item.id) * item.qty);
      }, 0)
      return {total: total}
    });
  });

  afterEach(() => jasmine.clock().uninstall())

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
