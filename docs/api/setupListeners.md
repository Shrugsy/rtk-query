---
id: setupListeners
title: setupListeners
sidebar_label: setupListeners
hide_title: true
hide_table_of_contents: false
---

# `setupListeners`

A utility used to enable `refetchOnMount` and `refetchOnReconnect` behaviors. It requires the `dispatch` method from your store. Calling `setupListeners(store.dispatch)` will configure listeners with the recommended defaults, but you have the optional of providing a callback for more granular control.

```ts title="setupListeners default configuration"
let initialized = false;
export function setupListeners(
  dispatch: ThunkDispatch<any, any, any>,
  customHandler?: (
    dispatch: ThunkDispatch<any, any, any>,
    actions: {
      onFocus: typeof onFocus;
      onFocusLost: typeof onFocusLost;
      onOnline: typeof onOnline;
      onOffline: typeof onOffline;
    }
  ) => () => void
) {
  function defaultHandler() {
    const handleFocus = () => dispatch(onFocus());
    const handleFocusLost = () => dispatch(onFocusLost());
    const handleOnline = () => dispatch(onOnline());
    const handleOffline = () => dispatch(onOffline());
    const handleVisibilityChange = () => {
      if (window.document.visibilityState === 'visible') {
        handleFocus();
      } else {
        handleFocusLost();
      }
    };

    if (!initialized) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        // Handle focus events
        window.addEventListener('visibilitychange', handleVisibilityChange, false);
        window.addEventListener('focus', handleFocus, false);

        // Handle connection events
        window.addEventListener('online', handleOnline, false);
        window.addEventListener('offline', handleOffline, false);
        initialized = true;
      }
    }
    const unsubscribe = () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      initialized = false;
    };
    return unsubscribe;
  }

  return customHandler ? customHandler(dispatch, { onFocus, onFocusLost, onOffline, onOnline }) : defaultHandler();
}
```

If you notice, `onFocus`, `onFocusLost`, `onOffline`, `onOnline` are all actions that are provided to the callback. Additionally, these actions are made available to `api.internalActions` and are able to be used by dispatching them like this:

```ts title="Manual onFocus event"
dispatch(api.internalActions.onFocus());
```
