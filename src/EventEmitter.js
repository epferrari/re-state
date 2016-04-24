"use-strict";

class SimpleEventEmitter {
	constructor(){
		this.listeners = {};
	}

	emit(event){
		let listeners;
		let args = ([]).slice.call(arguments, 1);
		if(listeners = this.listeners[event])
			listeners.forEach(l => l.handler.apply(l.binding, args));
	}

	on(event, handler, thisBinding){
		if(!this.listeners[event])
			this.listeners[event] = [];

		let listener = {handler, binding: thisBinding || Object.create(null)}
		this.listeners[event].push(listener);

		// return function to remove listener
		return () => {
			index = this.listeners[event].indexOf(listener);
			if(index !== -1)
				this.listeners[event].splice(index, 1);
		}
	}
}

module.exports = SimpleEventEmitter;
