import { InternalSerializeQueryArgs } from '../defaultSerializeQueryArgs';
import { Api, ApiContext } from '../apiTypes';
import { BaseQueryFn, BaseQueryArg, BaseQueryError, QueryReturnValue } from '../baseQueryTypes';
import { RootState, QueryKeys, QueryStatus, QuerySubstateIdentifier } from './apiState';
import { StartQueryActionCreatorOptions } from './buildInitiate';
import {
  AssertEntityTypes,
  calculateProvidedBy,
  EndpointDefinition,
  EndpointDefinitions,
  MutationApi,
  MutationDefinition,
  QueryApi,
  QueryArgFrom,
  QueryDefinition,
  ResultTypeFrom,
} from '../endpointDefinitions';
import {
  AsyncThunkPayloadCreator,
  Draft,
  isAllOf,
  isFulfilled,
  isPending,
  isRejected,
  isRejectedWithValue,
} from '@reduxjs/toolkit';
import { Patch, isDraftable, produceWithPatches, enablePatches } from 'immer';
import { AnyAction, createAsyncThunk, ThunkAction, ThunkDispatch, AsyncThunk } from '@reduxjs/toolkit';

import { HandledError } from '../HandledError';

import { ApiEndpointQuery, PrefetchOptions } from './module';
import { UnwrapPromise } from '../tsHelpers';

declare module './module' {
  export interface ApiEndpointQuery<
    Definition extends QueryDefinition<any, any, any, any, any>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Definitions extends EndpointDefinitions
  > extends Matchers<QueryThunk, Definition> {}

  export interface ApiEndpointMutation<
    Definition extends MutationDefinition<any, any, any, any, any>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Definitions extends EndpointDefinitions
  > extends Matchers<MutationThunk, Definition> {}
}

type EndpointThunk<
  Thunk extends AsyncThunk<any, any, any>,
  Definition extends EndpointDefinition<any, any, any, any>
> = Definition extends EndpointDefinition<infer QueryArg, infer BaseQueryFn, any, infer ResultType>
  ? Thunk extends AsyncThunk<infer ATResult, infer ATArg, infer ATConfig>
    ? AsyncThunk<
        ATResult & { result: ResultType },
        ATArg & { originalArgs: QueryArg },
        ATConfig & { rejectValue: BaseQueryError<BaseQueryFn> }
      >
    : never
  : never;

export type PendingAction<
  Thunk extends AsyncThunk<any, any, any>,
  Definition extends EndpointDefinition<any, any, any, any>
> = ReturnType<EndpointThunk<Thunk, Definition>['pending']>;

export type FulfilledAction<
  Thunk extends AsyncThunk<any, any, any>,
  Definition extends EndpointDefinition<any, any, any, any>
> = ReturnType<EndpointThunk<Thunk, Definition>['fulfilled']>;

export type RejectedAction<
  Thunk extends AsyncThunk<any, any, any>,
  Definition extends EndpointDefinition<any, any, any, any>
> = ReturnType<EndpointThunk<Thunk, Definition>['rejected']>;

export type Matcher<M> = (value: any) => value is M;

export interface Matchers<
  Thunk extends AsyncThunk<any, any, any>,
  Definition extends EndpointDefinition<any, any, any, any>
> {
  matchPending: Matcher<PendingAction<Thunk, Definition>>;
  matchFulfilled: Matcher<FulfilledAction<Thunk, Definition>>;
  matchRejected: Matcher<RejectedAction<Thunk, Definition>>;
}

export interface QueryThunkArg<_InternalQueryArgs> extends QuerySubstateIdentifier, StartQueryActionCreatorOptions {
  originalArgs: unknown;
  endpointName: string;
  startedTimeStamp: number;
}

export interface MutationThunkArg<_InternalQueryArgs> {
  originalArgs: unknown;
  endpointName: string;
  track?: boolean;
  startedTimeStamp: number;
}

export interface ThunkResult {
  fulfilledTimeStamp: number;
  result: unknown;
}

export type QueryThunk = AsyncThunk<ThunkResult, QueryThunkArg<any>, {}>;
export type MutationThunk = AsyncThunk<ThunkResult, MutationThunkArg<any>, {}>;

function defaultTransformResponse(baseQueryReturnValue: unknown) {
  return baseQueryReturnValue;
}

type MaybeDrafted<T> = T | Draft<T>;
type Recipe<T> = (data: MaybeDrafted<T>) => void | MaybeDrafted<T>;

export type PatchQueryResultThunk<Definitions extends EndpointDefinitions, PartialState> = <
  EndpointName extends QueryKeys<Definitions>
>(
  endpointName: EndpointName,
  args: QueryArgFrom<Definitions[EndpointName]>,
  patches: Patch[]
) => ThunkAction<void, PartialState, any, AnyAction>;

export type UpdateQueryResultThunk<Definitions extends EndpointDefinitions, PartialState> = <
  EndpointName extends QueryKeys<Definitions>
>(
  endpointName: EndpointName,
  args: QueryArgFrom<Definitions[EndpointName]>,
  updateRecipe: Recipe<ResultTypeFrom<Definitions[EndpointName]>>
) => ThunkAction<PatchCollection, PartialState, any, AnyAction>;

type PatchCollection = { patches: Patch[]; inversePatches: Patch[] };

export function buildThunks<
  BaseQuery extends BaseQueryFn,
  ReducerPath extends string,
  Definitions extends EndpointDefinitions
>({
  reducerPath,
  baseQuery,
  context: { endpointDefinitions },
  serializeQueryArgs,
  api,
}: {
  baseQuery: BaseQuery;
  reducerPath: ReducerPath;
  context: ApiContext<Definitions>;
  serializeQueryArgs: InternalSerializeQueryArgs<BaseQueryArg<BaseQuery>>;
  api: Api<BaseQuery, EndpointDefinitions, ReducerPath, any>;
}) {
  type InternalQueryArgs = BaseQueryArg<BaseQuery>;
  type State = RootState<any, string, ReducerPath>;

  const patchQueryResult: PatchQueryResultThunk<EndpointDefinitions, State> = (endpointName, args, patches) => (
    dispatch
  ) => {
    const endpointDefinition = endpointDefinitions[endpointName];
    dispatch(
      api.internalActions.queryResultPatched({
        queryCacheKey: serializeQueryArgs({
          queryArgs: args,
          endpointDefinition,
          endpointName,
        }),
        patches,
      })
    );
  };

  const updateQueryResult: UpdateQueryResultThunk<EndpointDefinitions, State> = (endpointName, args, updateRecipe) => (
    dispatch,
    getState
  ) => {
    const currentState = (api.endpoints[endpointName] as ApiEndpointQuery<any, any>).select(args)(getState());
    let ret: PatchCollection = { patches: [], inversePatches: [] };
    if (currentState.status === QueryStatus.uninitialized) {
      return ret;
    }
    if ('data' in currentState) {
      if (isDraftable(currentState.data)) {
        // call "enablePatches" as late as possible
        enablePatches();
        const [, patches, inversePatches] = produceWithPatches(currentState.data, updateRecipe);
        ret.patches.push(...patches);
        ret.inversePatches.push(...inversePatches);
      } else {
        const value = updateRecipe(currentState.data);
        ret.patches.push({ op: 'replace', path: [], value });
        ret.inversePatches.push({ op: 'replace', path: [], value: currentState.data });
      }
    }

    dispatch(patchQueryResult(endpointName, args, ret.patches));

    return ret;
  };

  const executeEndpoint: AsyncThunkPayloadCreator<
    ThunkResult,
    QueryThunkArg<InternalQueryArgs> | MutationThunkArg<InternalQueryArgs>,
    { state: RootState<any, string, ReducerPath> }
  > = async (arg, { signal, rejectWithValue, ...api }) => {
    const endpointDefinition = endpointDefinitions[arg.endpointName];

    const context: Record<string, any> = {};
    const queryApi: QueryApi<ReducerPath, any> | MutationApi<ReducerPath, any> = {
      ...api,
      context,
    };

    if (endpointDefinition.onStart) endpointDefinition.onStart(arg.originalArgs, queryApi);

    try {
      let transformResponse: (baseQueryReturnValue: any, meta: any) => any = defaultTransformResponse;
      let result: QueryReturnValue;
      const baseQueryApi = { signal, dispatch: api.dispatch, getState: api.getState };
      if (endpointDefinition.query) {
        result = await baseQuery(
          endpointDefinition.query(arg.originalArgs),
          baseQueryApi,
          endpointDefinition.extraOptions as any
        );

        if (endpointDefinition.transformResponse) {
          transformResponse = endpointDefinition.transformResponse;
        }
      } else {
        result = await endpointDefinition.queryFn(
          arg.originalArgs,
          baseQueryApi,
          endpointDefinition.extraOptions as any,
          (arg) => baseQuery(arg, baseQueryApi, endpointDefinition.extraOptions as any)
        );
      }
      if (result.error) throw new HandledError(result.error, result.meta);
      if (endpointDefinition.onSuccess)
        endpointDefinition.onSuccess(arg.originalArgs, queryApi, result.data, result.meta);
      return {
        fulfilledTimeStamp: Date.now(),
        result: await transformResponse(result.data, result.meta),
      };
    } catch (error) {
      if (endpointDefinition.onError)
        endpointDefinition.onError(
          arg.originalArgs,
          queryApi,
          error instanceof HandledError ? error.value : error,
          error instanceof HandledError ? error.meta : undefined
        );
      if (error instanceof HandledError) {
        return rejectWithValue(error.value);
      }
      throw error;
    }
  };

  const queryThunk = createAsyncThunk<
    ThunkResult,
    QueryThunkArg<InternalQueryArgs>,
    { state: RootState<any, string, ReducerPath> }
  >(`${reducerPath}/executeQuery`, executeEndpoint, {
    condition(arg, { getState }) {
      const state = getState()[reducerPath];
      const requestState = state?.queries?.[arg.queryCacheKey];
      const baseFetchOnMountOrArgChange = state.config.refetchOnMountOrArgChange;

      const fulfilledVal = requestState?.fulfilledTimeStamp;
      const refetchVal = arg.forceRefetch ?? (arg.subscribe && baseFetchOnMountOrArgChange);

      // Don't retry a request that's currently in-flight
      if (requestState?.status === 'pending') return false;

      // Pull from the cache unless we explicitly force refetch or qualify based on time
      if (fulfilledVal) {
        if (refetchVal) {
          // Return if its true or compare the dates because it must be a number
          return refetchVal === true || (Number(new Date()) - Number(fulfilledVal)) / 1000 >= refetchVal;
        }
        // Value is cached and we didn't specify to refresh, skip it.
        return false;
      }

      return true;
    },
    dispatchConditionRejection: true,
  });

  const mutationThunk = createAsyncThunk<
    ThunkResult,
    MutationThunkArg<InternalQueryArgs>,
    { state: RootState<any, string, ReducerPath> }
  >(`${reducerPath}/executeMutation`, executeEndpoint);

  const hasTheForce = (options: any): options is { force: boolean } => 'force' in options;
  const hasMaxAge = (options: any): options is { ifOlderThan: false | number } => 'ifOlderThan' in options;

  const prefetchThunk = <EndpointName extends QueryKeys<EndpointDefinitions>>(
    endpointName: EndpointName,
    arg: any,
    options: PrefetchOptions
  ): ThunkAction<void, any, any, AnyAction> => (dispatch: ThunkDispatch<any, any, any>, getState: () => any) => {
    const force = hasTheForce(options) && options.force;
    const maxAge = hasMaxAge(options) && options.ifOlderThan;

    const queryAction = (force: boolean = true) =>
      (api.endpoints[endpointName] as ApiEndpointQuery<any, any>).initiate(arg, { forceRefetch: force });
    const latestStateValue = (api.endpoints[endpointName] as ApiEndpointQuery<any, any>).select(arg)(getState());

    if (force) {
      dispatch(queryAction());
    } else if (maxAge) {
      const lastFulfilledTs = latestStateValue?.fulfilledTimeStamp;
      if (!lastFulfilledTs) {
        dispatch(queryAction());
        return;
      }
      const shouldRetrigger = (Number(new Date()) - Number(new Date(lastFulfilledTs))) / 1000 >= maxAge;
      if (shouldRetrigger) {
        dispatch(queryAction());
      }
    } else {
      // If prefetching with no options, just let it try
      dispatch(queryAction(false));
    }
  };

  function matchesEndpoint(endpointName: string) {
    return (action: any): action is AnyAction => action?.meta?.arg?.endpointName === endpointName;
  }

  function buildMatchThunkActions<
    Thunk extends AsyncThunk<any, QueryThunkArg<any>, any> | AsyncThunk<any, MutationThunkArg<any>, any>
  >(thunk: Thunk, endpointName: string) {
    return {
      matchPending: isAllOf(isPending(thunk), matchesEndpoint(endpointName)),
      matchFulfilled: isAllOf(isFulfilled(thunk), matchesEndpoint(endpointName)),
      matchRejected: isAllOf(isRejected(thunk), matchesEndpoint(endpointName)),
    } as Matchers<Thunk, any>;
  }

  return { queryThunk, mutationThunk, prefetchThunk, updateQueryResult, patchQueryResult, buildMatchThunkActions };
}

export function calculateProvidedByThunk(
  action: UnwrapPromise<ReturnType<ReturnType<QueryThunk>> | ReturnType<ReturnType<MutationThunk>>>,
  type: 'provides' | 'invalidates',
  endpointDefinitions: EndpointDefinitions,
  assertEntityType: AssertEntityTypes
) {
  return calculateProvidedBy(
    endpointDefinitions[action.meta.arg.endpointName][type],
    isFulfilled(action) ? action.payload.result : undefined,
    isRejectedWithValue(action) ? action.payload : undefined,
    action.meta.arg.originalArgs,
    assertEntityType
  );
}
