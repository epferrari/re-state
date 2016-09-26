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
    jasmine.clock().install();
    tick = () => jasmine.clock().tick(0);

    store = new Store({
      cart: [],
      priceList: {0: .25, 1: .50, 2: .75, 3: 0}
    });

    spyOn(store, 'trigger');

    let findById = (id, items) => _.find(items, item => (item.id === id));

    let getPrice = id => (store.state.priceList[id] || 0);

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
      return {cart};
    };

    updatePrice = new Action('updatePrice');
    onUpdatePrice = (lastState, newPriceRecord) => {
      let {priceList} = lastState.priceList;
      priceList[newPriceRecord.id] = newPriceRecord.price;
      return {priceList};
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
      }, 0);
      return {total};
    };
  });

  afterEach(() => jasmine.clock().uninstall());

  describe("creating an action", () => {
    it("must have a name", () => {
      let shouldThrow = () => {
        new Action();
      };

      expect(shouldThrow).toThrow()
    });

    describe("options", () => {
      it("#flushFrequency determines how often the Action's internal audit records are cleared", () => {
        addItem = new Action('addItem', {flushFrequency: 10});
        store.when(addItem, onAddItem, Action.strategies.COMPOUND);

        let add1 = addItem(1);
        let n = 9;
        while(n--){
          addItem(2);
        }
        expect(addItem.callCount).toEqual(10);
        tick();
        // at this point, 10 invocations have been made so the actions flushes
        // state is still transformed
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([
          {id: 1, qty: 1},
          {id: 2, qty: 9}
        ]);
        add1.undo();
        tick();
        // undo should have no effect because of the flush
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([
          {id: 1, qty: 1},
          {id: 2, qty: 9}
        ]);
      })
    })
  })

  describe("using Action's returned functions object", () => {
    beforeEach(() => {
      store.when(addItem, onAddItem);
    });

    it("#undo reverses the action's effect on state", () => {
      let itemAdded = addItem(0);
      expect(store.trigger).not.toHaveBeenCalled();

      tick();
      expect(store.state.cart).toEqual([{id:0, qty:1}]);
      expect(store.trigger).toHaveBeenCalledTimes(1);

      itemAdded.undo();
      tick();
      expect(store.state.cart).toEqual([]);
      expect(store.trigger).toHaveBeenCalledTimes(2);

      itemAdded.redo();
      tick();
      expect(store.state.cart).toEqual([{id:0, qty:1}]);
      expect(store.trigger).toHaveBeenCalledTimes(3);

      itemAdded.undo();
      tick();
      expect(store.state.cart).toEqual([]);
      expect(store.trigger).toHaveBeenCalledTimes(4);
    });

    it("#undo and #redo will not add or remove states from the history", () => {
      expect(store.depth).toBe(1);

      let itemAdded = addItem(0);
      tick();

      expect(store.trigger).toHaveBeenCalledTimes(1);
      expect(store.depth).toBe(2);

      itemAdded.undo();
      tick();
      expect(store.trigger).toHaveBeenCalledTimes(2);
      expect(store.depth).toBe(2);
    });

    it("#undo executes asyncronously", () => {
      let itemAdded = addItem(0);
      expect(store.trigger).not.toHaveBeenCalled();
      expect(store.state.cart).toEqual([]);

      itemAdded.undo();
      expect(store.trigger).not.toHaveBeenCalled();
      expect(store.state.cart).toEqual([]);

      tick();
      expect(store.trigger).toHaveBeenCalledTimes(1);
      expect(store.state.cart).toEqual([]);
    });

    describe("when the action is canceled before next tick", () => {
      it("still pushes a state to history", () => {
        expect(store.depth).toBe(1);
        let itemAdded = addItem(0);
        itemAdded.cancel();
        tick();
        expect(store.depth).toBe(2);
      });

      it("redoing still correctly applies original state transformation", () => {
        let itemAdded = addItem(1);
        itemAdded.cancel();

        tick();
        expect(store.state.cart).toEqual([]);

        itemAdded.redo();
        tick();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
      });
    });

    describe("when an action is canceled after it has transformed history", () => {
      it("has no effect", () => {
        let add = addItem(1);
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        add.cancel();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
      });
    });

    describe("when the same undo or redo function is called multiple times", () => {
      it("only triggers one reduce cycle", () => {
        let itemAdded = addItem(1);
        tick();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        expect(store.trigger).toHaveBeenCalledTimes(1);

        itemAdded.undo();
        tick();
        expect(store.state.cart).toEqual([]);
        expect(store.trigger).toHaveBeenCalledTimes(2);

        itemAdded.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(2);

        itemAdded.redo();
        tick();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        expect(store.trigger).toHaveBeenCalledTimes(3);

        itemAdded.redo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(3);
      });
    });

    describe("#flush", () => {
      it("removes references to the invocation so the action cannot be undone/redone", () => {
        let add = addItem(1);
        tick();

        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        add.flush();
        add.undo();
        tick();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
      })
    })
  });

  describe("using the `TAIL` strategy (Action.strategies.TAIL)", () => {
    beforeEach(() => {
      store.when(addItem, onAddItem, Action.strategies.TAIL);
    });

    it("updates the state from the last call to reducer", () => {
      expect(store.state.cart).toEqual([]);
      addItem(0);
      addItem(2);
      addItem(1);

      tick();
      expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
    });

    describe("undoing with `TAIL` strategy", () => {
      it("sets the state back to before the last action was called", () => {
        expect(store.state.cart).toEqual([]);
        let itemAdded = addItem(0);

        tick();
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

        itemAdded.undo();
        tick();
        expect(store.state.cart).toEqual([]);
      });

      it("does not update the state for reducer actions that were discarded by the tailing strategy", () => {
        let item0Added = addItem(0);
        let item2Added = addItem(2);
        let item1Added = addItem(1);

        tick();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();

        item0Added.undo();
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);

        item2Added.undo();
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
        expect(store.state.cart).toEqual([{id: 1, qty: 1}]);

        item1Added.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([]);
      });
    });
  });

  describe("using the `HEAD` strategy (Action.strategies.HEAD)", () => {
    beforeEach(() => store.when(addItem, onAddItem, Action.strategies.HEAD));

    it("updates the state from the first call to reducer action", () => {
      expect(store.state.cart).toEqual([]);
      addItem(0);
      addItem(2);
      addItem(1);

      tick();
      expect(store.state.cart).toEqual([{id: 0, qty: 1}]);
    });

    describe("undoing with `HEAD` strategy", () => {
      it("sets the state back to before the first action was called", () => {
        expect(store.state.cart).toEqual([]);
        let itemAdded = addItem(0);

        tick();
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

        itemAdded.undo();
        tick();
        expect(store.state.cart).toEqual([]);
      });

      it("does not update the state for reducer actions that were discarded by the head strategy", () => {
        let add0 = addItem(0);
        let add2 = addItem(2);
        let add1 = addItem(1);

        let $addItem = store.reducers[3];
        spyOn($addItem, 'invoke').and.callThrough();

        tick();

        expect($addItem.invoke).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();

        add1.undo();
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

        add2.undo();
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

        add0.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([]);
      });
    });
  });

  describe("using the `COMPOUND` strategy (Action.strategies.COMPOUND)", () => {
    beforeEach(() => store.when(addItem, onAddItem, Action.strategies.COMPOUND));

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
        let add1 = addItem(0);
        let add2 = addItem(0);
        let add3 = addItem(0);

        tick();
        expect(store.state.cart).toEqual([{id: 0, qty: 3}]);

        add3.undo();
        tick();
        expect(store.state.cart).toEqual([{id: 0, qty: 2}]);

        add2.undo();
        tick();
        expect(store.state.cart).toEqual([{id: 0, qty: 1}]);

        add1.undo();
        tick();
        expect(store.state.cart).toEqual([]);
      });

      it("noops the undo function once it is called", () =>{
        expect(store.state.cart).toEqual([]);
        let add1 = addItem(0);

        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([{id:0, qty: 1}]);

        add1.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(2);
        expect(store.state.cart).toEqual([]);

        add1.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(2);
      });

      it("leaves rest of state transformations intact", () =>{
        expect(store.state.cart).toEqual([]);
        let add0 = addItem(0);
        let add2 = addItem(2);
        let add1 = addItem(1);
        addItem(2);

        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 2, qty: 2}, {id: 1, qty: 1}]);

        add2.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(2);
        // notice that id:2 is now at the end. When history states were revised,
        // 2 was pushed by the last call to addItem because it's as if the first call with id:2 never happened
        expect(store.state.cart).toEqual([{id:0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}]);

        add0.undo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(3);
        expect(store.state.cart).toEqual([{id: 1, qty: 1}, {id: 2, qty: 1}]);

        add0.redo();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(4);
        expect(store.state.cart).toEqual([{id: 0, qty: 1}, {id: 1, qty: 1}, {id: 2, qty: 1}]);
      });
    });
  });

  describe("when a store is listening to many actions", () => {
    beforeEach(() => {
      spyOn(addItem,    'didInvoke').and.callThrough();
      spyOn(removeItem, 'didInvoke').and.callThrough();
      spyOn(clearCart,  'didInvoke').and.callThrough();
      spyOn(checkout,   'didInvoke').and.callThrough();

      store
        .when(addItem, onAddItem, 'compound')
        .when(removeItem, onRemoveItem, 'compound')
        .when(clearCart, onClearCart)
        .when(checkout, onCheckout);
    });

    it("invokes only the actions triggered in each reduce cycle", () => {
      removeItem(0);
      removeItem(0);
      checkout();

      tick();
      expect(addItem.didInvoke).not.toHaveBeenCalled();
      expect(removeItem.didInvoke).toHaveBeenCalled();
      expect(clearCart.didInvoke).not.toHaveBeenCalled();
      expect(checkout.didInvoke).toHaveBeenCalled();
    });

    it("transforms state by invoking the reducers in the order their actions were listened to", () => {
      checkout()
      removeItem(1);
      addItem(1);
      addItem(1);
      addItem(1);

      tick();
      expect(store.state.cart).toEqual([{id: 1, qty: 2}])
      expect(store.state.total).toEqual(1.0);
    });

    it("performs all undo/redo revisions in batch", () => {
      let add1 = addItem(1);
      let add2 = addItem(2);
      let checkedOut = checkout();

      tick();
      expect(store.state.cart).toEqual([
        {id: 1, qty: 1},
        {id: 2, qty: 1}
      ]);
      expect(store.state.total).toEqual(1.25);
      expect(store.trigger).toHaveBeenCalledTimes(1);

      add1.undo();
      checkedOut.undo();

      tick();
      expect(store.state.cart).toEqual([
        {id: 2, qty: 1}
      ]);
      expect(store.state.total).toBeUndefined();
      expect(store.trigger).toHaveBeenCalledTimes(2);
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

      store.when([
        {action: outerAction, reducer: handleOuterAction},
        {action: innerAction, reducer: handleInnerAction}
      ]);

      let shouldThrow = () => {
        outerAction('uh-oh');
        tick();
      };
      expect(shouldThrow).toThrow();
    });
  });

  describe("listening to the same action on multiple stores", () => {
    let addToCart, cart, rewardsPurchases;
    beforeEach(() => {
      addToCart = new Action("addToCart");
      cart = new Store({items:[]});
      rewardsPurchases = new Store({items:[]});

      cart.when(addToCart, (lastState, payload) => {
        lastState.items.push(payload)
        return lastState
      });

      rewardsPurchases.when(addToCart, (lastState, payload) => {
        if(payload.qualifiesForRewards)
          lastState.items.push(payload);
        return lastState;
      });
    });

    it("updates the state of both stores according to the reducer they registered with the action", () => {
      addToCart({
        id: 3,
        name: "Candy Bar"
      });

      tick();
      expect(cart.state.items.length).toBe(1);
      expect(rewardsPurchases.state.items.length).toBe(0);

      addToCart({
        id: 6,
        name: "Rolex",
        qualifiesForRewards: true
      });

      tick();
      expect(cart.state.items.length).toBe(2);
      expect(rewardsPurchases.state.items.length).toBe(1);
    });

    it("undoes/redoes state changes in both stores", () => {
      let added = addToCart({
        id: 6,
        name: "Rolex",
        qualifiesForRewards: true
      });

      tick();
      expect(cart.state.items.length).toBe(1);
      expect(rewardsPurchases.state.items.length).toBe(1);

      added.undo();
      tick();
      expect(cart.state.items.length).toBe(0);
      expect(rewardsPurchases.state.items.length).toBe(0);

      added.redo();
      tick();
      expect(cart.state.items.length).toBe(1);
      expect(rewardsPurchases.state.items.length).toBe(1);
    });
  });

  describe("flushing invocation tokens to free memory", () => {
    beforeEach(() => {
      store.when(addItem, onAddItem, Action.strategies.COMPOUND);
    });

    it("removes all tokens from the Action so no invocations may be undone or redone", () => {
      let add1 = addItem(1);
      let add2 = addItem(2);
      tick();
      let add3 = addItem(3);
      tick();
      expect(store.trigger).toHaveBeenCalledTimes(2);
      expect(store.state.cart).toEqual([
        {id: 1, qty: 1},
        {id: 2, qty: 1},
        {id: 3, qty: 1}
      ]);

      addItem.flush();
      add1.undo();
      add2.undo();
      add3.undo();
      tick();
      expect(store.trigger).toHaveBeenCalledTimes(2);
      expect(store.state.cart).toEqual([
        {id: 1, qty: 1},
        {id: 2, qty: 1},
        {id: 3, qty: 1}
      ]);
    });
  });
});
