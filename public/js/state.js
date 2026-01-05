/**
 * Simple observable state management
 */
class State {
  constructor(initialState = {}) {
    this._state = initialState;
    this._listeners = [];
  }

  /**
   * Get state value
   */
  get(key) {
    if (key) {
      return this._state[key];
    }
    return { ...this._state };
  }

  /**
   * Set state value
   */
  set(key, value) {
    this._state[key] = value;
    this._notify({ [key]: value });
  }

  /**
   * Update multiple state values
   */
  update(updates) {
    Object.assign(this._state, updates);
    this._notify(updates);
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this._listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this._listeners.indexOf(listener);
      if (index > -1) {
        this._listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners
   */
  _notify(changes) {
    this._listeners.forEach(listener => {
      try {
        listener(changes, this._state);
      } catch (error) {
        console.error('State listener error:', error);
      }
    });
  }

  /**
   * Clear all state
   */
  clear() {
    this._state = {};
    this._notify({});
  }
}

export default new State({
  user: null,
  proxies: [],
  modules: [],
  certificates: [],
  dashboardStats: null
});
