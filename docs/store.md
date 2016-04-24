<a name="StateStore"></a>

## StateStore
**Kind**: global class  

* [StateStore](#StateStore)
    * [new StateStore(initialState)](#new_StateStore_new)
    * [.listenTo(actions, strategy)](#StateStore+listenTo)
    * [.setState(deltaMap)](#StateStore+setState)
    * [.replaceState(newState)](#StateStore+replaceState)
    * [.reset(hard)](#StateStore+reset)
    * [.resetToState(index)](#StateStore+resetToState)
    * [.fastForward(n)](#StateStore+fastForward)
    * [.rewind(n)](#StateStore+rewind)
    * [.goto(index)](#StateStore+goto)
    * [.getImmutableState()](#StateStore+getImmutableState) ⇒ <code>Immutable.Map</code>
    * [.getInitialState()](#StateStore+getInitialState) ⇒ <code>object</code>
    * [.getStateAtIndex(index)](#StateStore+getStateAtIndex) ⇒ <code>object</code>
    * [.addListener(listener, [thisBinding])](#StateStore+addListener) ⇒ <code>function</code>
    * [.trigger()](#StateStore+trigger)

<a name="new_StateStore_new"></a>

### new StateStore(initialState)

| Param | Type | Description |
| --- | --- | --- |
| initialState | <code>object</code> | an initial state for your store |

<a name="StateStore+listenTo"></a>

### stateStore.listenTo(actions, strategy)
execute a reduce cycle when the action is called

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  

| Param | Type | Description |
| --- | --- | --- |
| actions | <code>function</code> &#124; <code>array</code> | created with `new Restate.Action(<reducer_function>)`   If passed an array, strategies can be defined like so: `[{action: <Action>[, strategy: <strategy>]}]`.   Object definitions and plain actions can be combined in the same array:   `[<Action>, {action: <Action>, strategy: <strategy>}, <Action>]` |
| strategy | <code>string</code> | one of `'compound'`, `'lead'`, or `'tail'` |

<a name="StateStore+setState"></a>

### stateStore.setState(deltaMap)
Reduce an updated state on the next tick by merging a plain object.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| deltaMap | <code>object</code> | a plain object of properties to be merged into state. Set a property's   value to the reserved keyword `"$unset"` to have the property removed from state. |

<a name="StateStore+replaceState"></a>

### stateStore.replaceState(newState)
replace the current state with a new state. Be aware that reducers coming after may expect properties
  that no longer exist on the state you replace with. Best to keep them the same shape.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| newState | <code>object</code> | a plain object of properties to be merged into state |

<a name="StateStore+reset"></a>

### stateStore.reset(hard)
Reset the app to it's original state. A hard reset will delete the state history, set the
  index to 0, and trigger with initial state. A soft reset will add a new entry to the end of
  history as initial state.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| hard | <code>boolean</code> | DESTRUCTIVE! delete entire history and start over at history[0] |

<a name="StateStore+resetToState"></a>

### stateStore.resetToState(index)
reset the StateStore's history to an index. DESTRUCTIVE! Deletes history past index.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| index | <code>int</code> | what state to move the history to |

<a name="StateStore+fastForward"></a>

### stateStore.fastForward(n)
move the StateStore's history index ahead `n` frames. Does not alter history.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| n | <code>int</code> | how many frames to fast froward. Cannot fast forward past the last frame. |

<a name="StateStore+rewind"></a>

### stateStore.rewind(n)
move the StateStore's history index back `n` frames. Does not alter history.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| n | <code>int</code> | how many frames to rewind. Cannot rewind past 0. |

<a name="StateStore+goto"></a>

### stateStore.goto(index)
move the StateStore's history index to `index`. Does not alter history.

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  

| Param | Type | Description |
| --- | --- | --- |
| index | <code>int</code> | the index to move to |

<a name="StateStore+getImmutableState"></a>

### stateStore.getImmutableState() ⇒ <code>Immutable.Map</code>
Get the current state as an Immutable Map

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
<a name="StateStore+getInitialState"></a>

### stateStore.getInitialState() ⇒ <code>object</code>
Get the initial app state that was passed to the constructor

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Returns**: <code>object</code> - state  
<a name="StateStore+getStateAtIndex"></a>

### stateStore.getStateAtIndex(index) ⇒ <code>object</code>
Get the app's state at a version in the state $$history

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Returns**: <code>object</code> - state  

| Param | Type |
| --- | --- |
| index | <code>int</code> | 

<a name="StateStore+addListener"></a>

### stateStore.addListener(listener, [thisBinding]) ⇒ <code>function</code>
add listener for changes to the store state

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Returns**: <code>function</code> - an unlisten function for the listener  

| Param | Type |
| --- | --- |
| listener | <code>function</code> | 
| [thisBinding] | <code>object</code> | 

<a name="StateStore+trigger"></a>

### stateStore.trigger()
trigger all listeners with the current state

**Kind**: instance method of <code>[StateStore](#StateStore)</code>  
**Emits**: <code>event:CHANGE_EVENT</code>  
