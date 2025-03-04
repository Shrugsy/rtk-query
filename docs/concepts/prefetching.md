---
id: prefetching
title: Prefetching
sidebar_label: Prefetching
hide_title: true
---

# Prefetching

The goal of prefetching is to make data fetch _before_ the user navigates to a page or attempts to load some known content.

There are a handful of situations that you may want to do this, but some very common use cases are:

1. User hovers over a navigation element
2. User hovers over a list element that is a link
3. User hovers over a next pagination button
4. User navigates to a page and you know that some components down the tree will require said data. This way, you can prevent fetching waterfalls.

### Prefetching with React Hooks

Similar to the [`useMutation`](./mutations) hook, the `usePrefetch` hook will not run automatically — it returns a `callback function`.

It accepts two arguments: the first is the key of a query action that you [defined in your API service](../api/createApi#endpoints), and the second is an object of two optional parameters:

```ts title="usePrefetch Signature"
export type PrefetchOptions =
  | { force?: boolean }
  | {
      ifOlderThan?: false | number;
    };

usePrefetch<EndpointName extends QueryKeys<Definitions>>(
    endpointName: EndpointName,
    options?: PrefetchOptions
  ): (arg: QueryArgFrom<Definitions[EndpointName]>, options?: PrefetchOptions) => void;
```

#### Customizing the hook behavior

You can specify these prefetch options when declaring the hook or at the call site. The call site will take priority over the defaults.

1. [summary](docblock://core/module.ts?token=PrefetchOptions)
2. [overloadSummary](docblock://core/module.ts?token=PrefetchOptions)

#### What to expect when you call the `callback`

1. The `callback` _always_ returns void.
2. If `force: true` is set during the declaration or at the call site, the query will be run no matter what. The one exception to that is if the same query is already in-flight.
3. If no options are specified and the query exists in the cache, the query will not be performed.
4. If no options are specified and the query _does not exist_ in the cache, the query will be performed.
   - **Assuming** you have a `useQuery` hook in the tree that is subscribed to the same query that you are prefetching:
     - `useQuery` will return `{isLoading: true, isFetching: true, ...rest`}
5. If `ifOlderThan` is specified but evaluates to false and the query is in the cache, the query will not be performed.
6. If `ifOlderThan` is specified and evaluates to true, the query will be performed even if there is an existing cache entry.
   - **Assuming** you have a `useQuery` hook in the tree that is subscribed to the same query that you are prefetching:
     - `useQuery` will return `{isLoading: false, isFetching: true, ...rest`}

```ts title="usePrefetch Example"
function User() {
  const prefetchUser = usePrefetch('getUser');

  // Low priority hover will not fire unless the last request happened more than 35s ago
  // High priority hover will _always_ fire
  return (
    <div>
      <button onMouseEnter={() => prefetchUser(4, { ifOlderThan: 35 })}>Low priority</button>
      <button onMouseEnter={() => prefetchUser(4, { force: true })}>High priority</button>
    </div>
  );
}
```

#### Recipe: Prefetch Immediately

In some cases, you may want to prefetch a resource immediately. You can implement this in just a few lines of code:

```ts title="hooks/usePrefetchImmediately.ts"
type EndpointNames = keyof typeof api.endpoints;

export function usePrefetchImmediately<T extends EndpointNames>(
  endpoint: T,
  arg: Parameters<typeof api.endpoints[T]['initiate']>[0],
  options: PrefetchOptions = {}
) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch(api.util.prefetchThunk(endpoint, arg, options));
  }, []);
}

// In a component
usePrefetchImmediately('getUser', 5);
```

### Prefetching without hooks

If you're not using the `usePrefetch` hook, you can recreate the same behavior easily on your own in any framework.

When dispatching the `prefetchThunk` as shown below you will see the same exact behavior as [described here](#what-to-expect-when-you-call-the-callback).

```js title="Non-hook prefetching example"
store.dispatch(api.util.prefetchThunk(endpointName, arg, { force: false, ifOlderThan: 10 }));
```

You can also dispatch the query action, but you would be responsible for implementing any additional logic.

```js title="Alternate method of manual prefetching"
dispatch(api.endpoints[endpointName].initiate(arg, { forceRefetch: true }));
```

### Example

This is a very basic example that shows how you can prefetch when a user hovers over the next arrow. This is probably not the optimal solution, because if they hover, click, then change pages without moving their mouse, we wouldn't know to prefetch the next page because we wouldn't see the next `onMouseEnter` event. In this case, you would need to handle this on your own. You could also consider automatically prefetching the next page...

<iframe
  src="https://codesandbox.io/embed/concepts-prefetching-h594j?fontsize=12&hidenavigation=1&theme=dark"
  style={{ width: '100%', height: '600px', border: 0, borderRadius: '4px', overflow: 'hidden' }}
  title="rtk-query-react-hooks-usePrefetch-example"
  allow="geolocation; microphone; camera; midi; vr; accelerometer; gyroscope; payment; ambient-light-sensor; encrypted-media; usb"
  sandbox="allow-modals allow-forms allow-popups allow-scripts allow-same-origin"
></iframe>

### Automatic Prefetching Example

Picking up on our last example, we automatically `prefetch` the next page, giving the appearance of no network delay.

<iframe
  src="https://codesandbox.io/embed/concepts-prefetching-automatic-2id61?fontsize=12&hidenavigation=1&theme=dark"
  style={{ width: '100%', height: '600px', border: 0, borderRadius: '4px', overflow: 'hidden' }}
  title="rtk-query-react-hooks-usePrefetch-example"
  allow="geolocation; microphone; camera; midi; vr; accelerometer; gyroscope; payment; ambient-light-sensor; encrypted-media; usb"
  sandbox="allow-modals allow-forms allow-popups allow-scripts allow-same-origin"
></iframe>

#### Prefetching All Known Pages

After the first query initialized by `useQuery` runs, we automatically fetch all remaining pages.

<iframe
  src="https://codesandbox.io/embed/concepts-prefetching-automatic-waterfall-ihe5e?fontsize=12&hidenavigation=1&theme=dark&module=%2Fsrc%2Ffeatures%2Fposts%2FPostsManager.tsx"
  style={{ width: '100%', height: '600px', border: 0, borderRadius: '4px', overflow: 'hidden' }}
     title="Concepts Prefetching Automatic Waterfall"
  allow="geolocation; microphone; camera; midi; vr; accelerometer; gyroscope; payment; ambient-light-sensor; encrypted-media; usb"
  sandbox="allow-modals allow-forms allow-popups allow-scripts allow-same-origin"
></iframe>
