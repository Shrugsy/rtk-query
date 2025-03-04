import { AnyAction, createSelector, ThunkAction, ThunkDispatch } from '@reduxjs/toolkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MutationSubState,
  QueryStatus,
  QuerySubState,
  RequestStatusFlags,
  SubscriptionOptions,
  QueryKeys,
  RootState,
} from '../core/apiState';
import {
  EndpointDefinitions,
  MutationDefinition,
  QueryDefinition,
  QueryArgFrom,
  ResultTypeFrom,
} from '../endpointDefinitions';
import { QueryResultSelectorResult, skipSelector } from '../core/buildSelectors';
import { QueryActionCreatorResult, MutationActionCreatorResult } from '../core/buildInitiate';
import { shallowEqual } from '../utils';
import { Api } from '../apiTypes';
import { Id, NoInfer, Override } from '../tsHelpers';
import { ApiEndpointMutation, ApiEndpointQuery, CoreModule, PrefetchOptions } from '../core/module';
import { ReactHooksModuleOptions } from './module';
import { useShallowStableValue } from './useShallowStableValue';
import { UninitializedValue, UNINITIALIZED_VALUE } from '../constants';

export interface QueryHooks<Definition extends QueryDefinition<any, any, any, any, any>> {
  useQuery: UseQuery<Definition>;
  useLazyQuery: UseLazyQuery<Definition>;
  useQuerySubscription: UseQuerySubscription<Definition>;
  useLazyQuerySubscription: UseLazyQuerySubscription<Definition>;
  useQueryState: UseQueryState<Definition>;
}

export interface MutationHooks<Definition extends MutationDefinition<any, any, any, any, any>> {
  useMutation: MutationHook<Definition>;
}

/**
 * test description here
 */
export type UseQuery<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  arg: QueryArgFrom<D>,
  options?: UseQuerySubscriptionOptions & UseQueryStateOptions<D, R>
) => UseQueryStateResult<D, R> & ReturnType<UseQuerySubscription<D>>;

interface UseQuerySubscriptionOptions extends SubscriptionOptions {
  /**
   * Prevents a query from automatically running.
   *
   * @remarks
   * When skip is true:
   *
   * - **If the query has cached data:**
   *   * The cached data **will not be used** on the initial load, and will ignore updates from any identical query until the `skip` condition is removed
   *   * The query will have a status of `uninitialized`
   *   * If `skip: false` is set after skipping the initial load, the cached result will be used
   * - **If the query does not have cached data:**
   *   * The query will have a status of `uninitialized`
   *   * The query will not exist in the state when viewed with the dev tools
   *   * The query will not automatically fetch on mount
   *   * The query will not automatically run when additional components with the same query are added that do run
   *
   * @example
   * ```ts
   * // codeblock-meta title="Skip example"
   * const Pokemon = ({ name, skip }: { name: string; skip: boolean }) => {
   *   const { data, error, status } = useGetPokemonByNameQuery(name, {
   *     skip,
   *   });
   *
   *   return (
   *     <div>
   *       {name} - {status}
   *     </div>
   *   );
   * };
   * ```
   */
  skip?: boolean;
  /**
   * Defaults to `false`. This setting allows you to control whether if a cached result is already available, RTK Query will only serve a cached result, or if it should `refetch` when set to `true` or if an adequate amount of time has passed since the last successful query result.
   * - `false` - Will not cause a query to be performed _unless_ it does not exist yet.
   * - `true` - Will always refetch when a new subscriber to a query is added. Behaves the same as calling the `refetch` callback or passing `forceRefetch: true` in the action creator.
   * - `number` - **Value is in seconds**. If a number is provided and there is an existing query in the cache, it will compare the current time vs the last fulfilled timestamp, and only refetch if enough time has elapsed.
   *
   * If you specify this option alongside `skip: true`, this **will not be evaluated** until `skip` is false.
   */
  refetchOnMountOrArgChange?: boolean | number;
}

export type UseQuerySubscription<D extends QueryDefinition<any, any, any, any>> = (
  arg: QueryArgFrom<D>,
  options?: UseQuerySubscriptionOptions
) => Pick<QueryActionCreatorResult<D>, 'refetch'>;

export type UseLazyQueryLastPromiseInfo<D extends QueryDefinition<any, any, any, any>> = {
  lastArg: QueryArgFrom<D>;
};
export type UseLazyQuery<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  options?: SubscriptionOptions & Omit<UseQueryStateOptions<D, R>, 'skip'>
) => [(arg: QueryArgFrom<D>) => void, UseQueryStateResult<D, R>, UseLazyQueryLastPromiseInfo<D>];

export type UseLazyQuerySubscription<D extends QueryDefinition<any, any, any, any>> = (
  options?: SubscriptionOptions
) => [(arg: QueryArgFrom<D>) => void, QueryArgFrom<D> | UninitializedValue];

export type QueryStateSelector<R, D extends QueryDefinition<any, any, any, any>> = (
  state: QueryResultSelectorResult<D>,
  lastResult: R | undefined,
  defaultQueryStateSelector: DefaultQueryStateSelector<D>
) => R;

export type DefaultQueryStateSelector<D extends QueryDefinition<any, any, any, any>> = (
  state: QueryResultSelectorResult<D>,
  lastResult: Pick<UseQueryStateDefaultResult<D>, 'data'>
) => UseQueryStateDefaultResult<D>;

export type UseQueryState<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  arg: QueryArgFrom<D>,
  options?: UseQueryStateOptions<D, R>
) => UseQueryStateResult<D, R>;

export type UseQueryStateOptions<D extends QueryDefinition<any, any, any, any>, R> = {
  /**
   * Prevents a query from automatically running.
   *
   * @remarks
   * When skip is true:
   *
   * - **If the query has cached data:**
   *   * The cached data **will not be used** on the initial load, and will ignore updates from any identical query until the `skip` condition is removed
   *   * The query will have a status of `uninitialized`
   *   * If `skip: false` is set after skipping the initial load, the cached result will be used
   * - **If the query does not have cached data:**
   *   * The query will have a status of `uninitialized`
   *   * The query will not exist in the state when viewed with the dev tools
   *   * The query will not automatically fetch on mount
   *   * The query will not automatically run when additional components with the same query are added that do run
   *
   * @example
   * ```ts
   * // codeblock-meta title="Skip example"
   * const Pokemon = ({ name, skip }: { name: string; skip: boolean }) => {
   *   const { data, error, status } = useGetPokemonByNameQuery(name, {
   *     skip,
   *   });
   *
   *   return (
   *     <div>
   *       {name} - {status}
   *     </div>
   *   );
   * };
   * ```
   */
  skip?: boolean;
  /**
   * `selectFromResult` allows you to get a specific segment from a query result in a performant manner.
   * When using this feature, the component will not rerender unless the underlying data of the selected item has changed.
   * If the selected item is one element in a larger collection, it will disregard changes to elements in the same collection.
   *
   * @example
   * ```ts
   * // codeblock-meta title="Using selectFromResult to extract a single result"
   * function PostsList() {
   *   const { data: posts } = api.useGetPostsQuery();
   *
   *   return (
   *     <ul>
   *       {posts?.data?.map((post) => (
   *         <PostById key={post.id} id={post.id} />
   *       ))}
   *     </ul>
   *   );
   * }
   *
   * function PostById({ id }: { id: number }) {
   *   // Will select the post with the given id, and will only rerender if the given posts data changes
   *   const { post } = api.useGetPostsQuery(undefined, {
   *     selectFromResult: ({ data }) => ({ post: data?.find((post) => post.id === id) }),
   *   });
   *
   *   return <li>{post?.name}</li>;
   * }
   * ```
   */
  selectFromResult?: QueryStateSelector<R, D>;
};

export type UseQueryStateResult<_ extends QueryDefinition<any, any, any, any>, R> = NoInfer<R>;

type UseQueryStateBaseResult<D extends QueryDefinition<any, any, any, any>> = QuerySubState<D> & {
  /**
   * Query has not started yet.
   */
  isUninitialized: false;
  /**
   * Query is currently loading for the first time. No data yet.
   */
  isLoading: false;
  /**
   * Query is currently fetching, but might have data from an earlier request.
   */
  isFetching: false;
  /**
   * Query has data from a successful load.
   */
  isSuccess: false;
  /**
   * Query is currently in "error" state.
   */
  isError: false;
};

type UseQueryStateDefaultResult<D extends QueryDefinition<any, any, any, any>> = Id<
  | Override<Extract<UseQueryStateBaseResult<D>, { status: QueryStatus.uninitialized }>, { isUninitialized: true }>
  | Override<
      UseQueryStateBaseResult<D>,
      | { isLoading: true; isFetching: boolean; data: undefined }
      | ({ isSuccess: true; isFetching: boolean; error: undefined } & Required<
          Pick<UseQueryStateBaseResult<D>, 'data' | 'fulfilledTimeStamp'>
        >)
      | ({ isError: true } & Required<Pick<UseQueryStateBaseResult<D>, 'error'>>)
    >
> & {
  /**
   * @deprecated will be removed in the next version
   * please use the `isLoading`, `isFetching`, `isSuccess`, `isError`
   * and `isUninitialized` flags instead
   */
  status: QueryStatus;
};

export type MutationHook<D extends MutationDefinition<any, any, any, any>> = () => [
  (
    arg: QueryArgFrom<D>
  ) => {
    /**
     * Unwraps a mutation call to provide the raw response/error.
     *
     * @remarks
     * If you need to access the error or success payload immediately after a mutation, you can chain .unwrap().
     *
     * @example
     * ```ts
     * // codeblock-meta title="Using .unwrap"
     * addPost({ id: 1, name: 'Example' })
     *   .unwrap()
     *   .then((payload) => console.log('fulfilled', payload))
     *   .catch((error) => console.error('rejected', error));
     * ```
     *
     * @example
     * ```ts
     * // codeblock-meta title="Using .unwrap with async await"
     * try {
     *   const payload = await addPost({ id: 1, name: 'Example' }).unwrap();
     *   console.log('fulfilled', payload)
     * } catch (error) {
     *   console.error('rejected', error);
     * }
     * ```
     */
    unwrap: () => Promise<ResultTypeFrom<D>>;
  },
  MutationSubState<D> & RequestStatusFlags
];

const defaultQueryStateSelector: DefaultQueryStateSelector<any> = (currentState, lastResult) => {
  // data is the last known good request result we have tracked - or if none has been tracked yet the last good result for the current args
  const data = (currentState.isSuccess ? currentState.data : lastResult?.data) ?? currentState.data;

  // isFetching = true any time a request is in flight
  const isFetching = currentState.isLoading;
  // isLoading = true only when loading while no data is present yet (initial load with no data in the cache)
  const isLoading = !data && isFetching;
  // isSuccess = true when data is present
  const isSuccess = currentState.isSuccess || (isFetching && !!data);

  return { ...currentState, data, isFetching, isLoading, isSuccess } as UseQueryStateDefaultResult<any>;
};

/**
 * Wrapper around `defaultQueryStateSelector` to be used in `useQuery`.
 * We want the initial render to already come back with
 * `{ isUninitialized: false, isFetching: true, isLoading: true }`
 * to prevent that the library user has to do an additional check for `isUninitialized`/
 */
const noPendingQueryStateSelector: DefaultQueryStateSelector<any> = (currentState, lastResult) => {
  const selected = defaultQueryStateSelector(currentState, lastResult);
  if (selected.isUninitialized) {
    return {
      ...selected,
      isUninitialized: false,
      isFetching: true,
      isLoading: true,
      status: QueryStatus.pending,
    };
  }
  return selected;
};

type GenericPrefetchThunk = (
  endpointName: any,
  arg: any,
  options: PrefetchOptions
) => ThunkAction<void, any, any, AnyAction>;

/**
 *
 * @param opts.api - An API with defined endpoints to create hooks for
 * @param opts.moduleOptions.batch - The version of the `batchedUpdates` function to be used
 * @param opts.moduleOptions.useDispatch - The version of the `useDispatch` hook to be used
 * @param opts.moduleOptions.useSelector - The version of the `useSelector` hook to be used
 * @returns An object containing functions to generate hooks based on an endpoint
 */
export function buildHooks<Definitions extends EndpointDefinitions>({
  api,
  moduleOptions: { batch, useDispatch, useSelector },
}: {
  api: Api<any, Definitions, any, any, CoreModule>;
  moduleOptions: Required<ReactHooksModuleOptions>;
}) {
  return { buildQueryHooks, buildMutationHook, usePrefetch };

  function usePrefetch<EndpointName extends QueryKeys<Definitions>>(
    endpointName: EndpointName,
    defaultOptions?: PrefetchOptions
  ) {
    const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
    const stableDefaultOptions = useShallowStableValue(defaultOptions);

    return useCallback(
      (arg: any, options?: PrefetchOptions) =>
        dispatch(
          (api.util.prefetchThunk as GenericPrefetchThunk)(endpointName, arg, { ...stableDefaultOptions, ...options })
        ),
      [endpointName, dispatch, stableDefaultOptions]
    );
  }

  function buildQueryHooks(name: string): QueryHooks<any> {
    const useQuerySubscription: UseQuerySubscription<any> = (
      arg: any,
      { refetchOnReconnect, refetchOnFocus, refetchOnMountOrArgChange, skip = false, pollingInterval = 0 } = {}
    ) => {
      const { initiate } = api.endpoints[name] as ApiEndpointQuery<
        QueryDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const stableArg = useShallowStableValue(arg);
      const stableSubscriptionOptions = useShallowStableValue({
        refetchOnReconnect,
        refetchOnFocus,
        pollingInterval,
      });

      const promiseRef = useRef<QueryActionCreatorResult<any>>();

      useEffect(() => {
        if (skip) {
          return;
        }

        const lastPromise = promiseRef.current;
        const lastSubscriptionOptions = promiseRef.current?.subscriptionOptions;

        if (!lastPromise || lastPromise.arg !== stableArg) {
          lastPromise?.unsubscribe();
          const promise = dispatch(
            initiate(stableArg, {
              subscriptionOptions: stableSubscriptionOptions,
              forceRefetch: refetchOnMountOrArgChange,
            })
          );
          promiseRef.current = promise;
        } else if (stableSubscriptionOptions !== lastSubscriptionOptions) {
          lastPromise.updateSubscriptionOptions(stableSubscriptionOptions);
        }
      }, [dispatch, initiate, refetchOnMountOrArgChange, skip, stableArg, stableSubscriptionOptions]);

      useEffect(() => {
        return () => {
          promiseRef.current?.unsubscribe();
          promiseRef.current = undefined;
        };
      }, []);

      return useMemo(
        () => ({
          /**
           * A method to manually refetch data for the query
           */
          refetch: () => void promiseRef.current?.refetch(),
        }),
        []
      );
    };

    const useLazyQuerySubscription: UseLazyQuerySubscription<any> = ({
      refetchOnReconnect,
      refetchOnFocus,
      pollingInterval = 0,
    } = {}) => {
      const { initiate } = api.endpoints[name] as ApiEndpointQuery<
        QueryDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();

      const [arg, setArg] = useState<any>(UNINITIALIZED_VALUE);
      const promiseRef = useRef<QueryActionCreatorResult<any> | undefined>();

      const stableSubscriptionOptions = useShallowStableValue({
        refetchOnReconnect,
        refetchOnFocus,
        pollingInterval,
      });

      useEffect(() => {
        const lastSubscriptionOptions = promiseRef.current?.subscriptionOptions;

        if (stableSubscriptionOptions !== lastSubscriptionOptions) {
          promiseRef.current?.updateSubscriptionOptions(stableSubscriptionOptions);
        }
      }, [stableSubscriptionOptions]);

      const subscriptionOptionsRef = useRef(stableSubscriptionOptions);
      useEffect(() => {
        subscriptionOptionsRef.current = stableSubscriptionOptions;
      }, [stableSubscriptionOptions]);

      const trigger = useCallback(
        function (arg: any, preferCacheValue = false) {
          batch(() => {
            promiseRef.current?.unsubscribe();

            promiseRef.current = dispatch(
              initiate(arg, {
                subscriptionOptions: subscriptionOptionsRef.current,
                forceRefetch: !preferCacheValue,
              })
            );
            setArg(arg);
          });
        },
        [dispatch, initiate]
      );

      /* cleanup on unmount */
      useEffect(() => {
        return () => {
          promiseRef?.current?.unsubscribe();
        };
      }, []);

      /* if "cleanup on unmount" was triggered from a fast refresh, we want to reinstate the query */
      useEffect(() => {
        if (arg !== UNINITIALIZED_VALUE && !promiseRef.current) {
          trigger(arg, true);
        }
      }, [arg, trigger]);

      return useMemo(() => [trigger, arg], [trigger, arg]);
    };

    const useQueryState: UseQueryState<any> = (
      arg: any,
      { skip = false, selectFromResult = defaultQueryStateSelector as QueryStateSelector<any, any> } = {}
    ) => {
      const { select } = api.endpoints[name] as ApiEndpointQuery<QueryDefinition<any, any, any, any, any>, Definitions>;
      const stableArg = useShallowStableValue(arg);

      const lastValue = useRef<any>();

      const querySelector = useMemo(
        () =>
          createSelector(
            [select(skip ? skipSelector : stableArg), (_: any, lastResult: any) => lastResult],
            (subState, lastResult) => selectFromResult(subState, lastResult, defaultQueryStateSelector)
          ),
        [select, skip, stableArg, selectFromResult]
      );

      const currentState = useSelector(
        (state: RootState<Definitions, any, any>) => querySelector(state, lastValue.current),
        shallowEqual
      );

      useEffect(() => {
        lastValue.current = currentState;
      }, [currentState]);

      return currentState;
    };

    return {
      useQueryState,
      useQuerySubscription,
      useLazyQuerySubscription,
      useLazyQuery(options) {
        const [trigger, arg] = useLazyQuerySubscription(options);
        const queryStateResults = useQueryState(arg, {
          ...options,
          skip: arg === UNINITIALIZED_VALUE,
        });

        const info = useMemo(() => ({ lastArg: arg }), [arg]);
        return useMemo(() => [trigger, queryStateResults, info], [trigger, queryStateResults, info]);
      },
      useQuery(arg, options) {
        const querySubscriptionResults = useQuerySubscription(arg, options);
        const queryStateResults = useQueryState(arg, {
          selectFromResult: options?.skip ? undefined : (noPendingQueryStateSelector as QueryStateSelector<any, any>),
          ...options,
        });
        return useMemo(() => ({ ...queryStateResults, ...querySubscriptionResults }), [
          queryStateResults,
          querySubscriptionResults,
        ]);
      },
    };
  }

  function buildMutationHook(name: string): MutationHook<any> {
    return () => {
      const { select, initiate } = api.endpoints[name] as ApiEndpointMutation<
        MutationDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const [requestId, setRequestId] = useState<string>();

      const promiseRef = useRef<MutationActionCreatorResult<any>>();

      useEffect(() => {
        return () => {
          promiseRef.current?.unsubscribe();
          promiseRef.current = undefined;
        };
      }, []);

      const triggerMutation = useCallback(
        function (arg) {
          let promise: MutationActionCreatorResult<any>;
          batch(() => {
            promiseRef?.current?.unsubscribe();
            promise = dispatch(initiate(arg));
            promiseRef.current = promise;
            setRequestId(promise.requestId);
          });
          return promise!;
        },
        [dispatch, initiate]
      );

      const mutationSelector = useMemo(() => select(requestId || skipSelector), [requestId, select]);
      const currentState = useSelector(mutationSelector);

      return useMemo(() => [triggerMutation, currentState], [triggerMutation, currentState]);
    };
  }
}
