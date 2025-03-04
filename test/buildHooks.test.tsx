import * as React from 'react';
import { createApi, fetchBaseQuery, QueryStatus } from '@rtk-incubator/rtk-query/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';
import { expectExactType, matchSequence, setupApiStore, useRenderCounter, waitMs } from './helpers';
import { server } from './mocks/server';
import { AnyAction } from 'redux';
import { SubscriptionOptions } from '@internal/core/apiState';

// Just setup a temporary in-memory counter for tests that `getIncrementedAmount`.
// This can be used to test how many renders happen due to data changes or
// the refetching behavior of components.
let amount = 0;

const api = createApi({
  baseQuery: async (arg: any) => {
    await waitMs();
    if (arg?.body && 'amount' in arg.body) {
      amount += 1;
    }
    return { data: arg?.body ? { ...arg.body, ...(amount ? { amount } : {}) } : undefined };
  },
  endpoints: (build) => ({
    getUser: build.query<any, number>({
      query: (arg) => arg,
    }),
    getIncrementedAmount: build.query<any, void>({
      query: () => ({
        url: '',
        body: {
          amount,
        },
      }),
    }),
    updateUser: build.mutation<any, { name: string }>({
      query: (update) => ({ body: update }),
    }),
    getError: build.query({
      query: (query) => '/error',
    }),
  }),
});

const storeRef = setupApiStore(api, {
  actions(state: AnyAction[] = [], action: AnyAction) {
    return [...state, action];
  },
});

afterEach(() => {
  amount = 0;
});

describe('hooks tests', () => {
  describe('useQuery', () => {
    let getRenderCount: () => number = () => 0;

    test('useQuery hook basic render count assumptions', async () => {
      function User() {
        getRenderCount = useRenderCounter();

        const { isFetching } = api.endpoints.getUser.useQuery(1);

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      expect(getRenderCount()).toBe(2); // By the time this runs, the initial render will happen, and the query will start immediately running by the time we can expect this

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(3);
    });

    test('useQuery hook sets isFetching=true whenever a request is in flight', async () => {
      function User() {
        getRenderCount = useRenderCounter();
        const [value, setValue] = React.useState(0);

        const { isFetching } = api.endpoints.getUser.useQuery(1, { skip: value < 1 });

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <button onClick={() => setValue((val) => val + 1)}>Increment value</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      expect(getRenderCount()).toBe(1);

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      fireEvent.click(screen.getByText('Increment value')); // setState = 1, perform request = 2
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(4);

      fireEvent.click(screen.getByText('Increment value'));
      // Being that nothing has changed in the args, this should never fire.
      expect(screen.getByTestId('isFetching').textContent).toBe('false');
      expect(getRenderCount()).toBe(5); // even though there was no request, the button click updates the state so this is an expected render
    });

    test('useQuery hook sets isLoading=true only on initial request', async () => {
      let refetch: any, isLoading: boolean;
      function User() {
        const [value, setValue] = React.useState(0);

        ({ isLoading, refetch } = api.endpoints.getUser.useQuery(2, { skip: value < 1 }));
        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <button onClick={() => setValue((val) => val + 1)}>Increment value</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      // Being that we skipped the initial request on mount, this should be false
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
      fireEvent.click(screen.getByText('Increment value'));
      // Condition is met, should load
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false')); // Make sure the original loading has completed.
      fireEvent.click(screen.getByText('Increment value'));
      // Being that we already have data, isLoading should be false
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
      // We call a refetch, should set to true
      act(() => refetch());
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
    });

    test('useQuery hook sets isLoading and isFetching to the correct states', async () => {
      let refetchMe: () => void = () => {};
      function User() {
        const [value, setValue] = React.useState(0);
        getRenderCount = useRenderCounter();

        const { isLoading, isFetching, refetch } = api.endpoints.getUser.useQuery(22, { skip: value < 1 });
        refetchMe = refetch;
        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <button onClick={() => setValue((val) => val + 1)}>Increment value</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      expect(getRenderCount()).toBe(1);

      expect(screen.getByTestId('isLoading').textContent).toBe('false');
      expect(screen.getByTestId('isFetching').textContent).toBe('false');

      fireEvent.click(screen.getByText('Increment value')); // renders: set state = 1, perform request = 2
      // Condition is met, should load
      await waitFor(() => {
        expect(screen.getByTestId('isLoading').textContent).toBe('true');
        expect(screen.getByTestId('isFetching').textContent).toBe('true');
      });

      // Make sure the request is done for sure.
      await waitFor(() => {
        expect(screen.getByTestId('isLoading').textContent).toBe('false');
        expect(screen.getByTestId('isFetching').textContent).toBe('false');
      });
      expect(getRenderCount()).toBe(4);

      fireEvent.click(screen.getByText('Increment value'));
      // Being that we already have data and changing the value doesn't trigger a new request, only the button click should impact the render
      await waitFor(() => {
        expect(screen.getByTestId('isLoading').textContent).toBe('false');
        expect(screen.getByTestId('isFetching').textContent).toBe('false');
      });
      expect(getRenderCount()).toBe(5);

      // We call a refetch, should set both to true, then false when complete/errored
      act(() => refetchMe());
      await waitFor(() => {
        expect(screen.getByTestId('isLoading').textContent).toBe('true');
        expect(screen.getByTestId('isFetching').textContent).toBe('true');
      });
      await waitFor(() => {
        expect(screen.getByTestId('isLoading').textContent).toBe('false');
        expect(screen.getByTestId('isFetching').textContent).toBe('false');
      });
      expect(getRenderCount()).toBe(7);
    });

    test('useQuery hook respects refetchOnMountOrArgChange: true', async () => {
      let data, isLoading, isFetching;
      function User() {
        ({ data, isLoading, isFetching } = api.endpoints.getIncrementedAmount.useQuery(undefined, {
          refetchOnMountOrArgChange: true,
        }));
        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="amount">{String(data?.amount)}</div>
          </div>
        );
      }

      const { unmount } = render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

      unmount();

      render(<User />, { wrapper: storeRef.wrapper });
      // Let's make sure we actually fetch, and we increment
      expect(screen.getByTestId('isLoading').textContent).toBe('false');
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('2'));
    });

    test('useQuery does not refetch when refetchOnMountOrArgChange: NUMBER condition is not met', async () => {
      let data, isLoading, isFetching;
      function User() {
        ({ data, isLoading, isFetching } = api.endpoints.getIncrementedAmount.useQuery(undefined, {
          refetchOnMountOrArgChange: 10,
        }));
        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="amount">{String(data?.amount)}</div>
          </div>
        );
      }

      const { unmount } = render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

      unmount();

      render(<User />, { wrapper: storeRef.wrapper });
      // Let's make sure we actually fetch, and we increment. Should be false because we do this immediately
      // and the condition is set to 10 seconds
      expect(screen.getByTestId('isFetching').textContent).toBe('false');
      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));
    });

    test('useQuery refetches when refetchOnMountOrArgChange: NUMBER condition is met', async () => {
      let data, isLoading, isFetching;
      function User() {
        ({ data, isLoading, isFetching } = api.endpoints.getIncrementedAmount.useQuery(undefined, {
          refetchOnMountOrArgChange: 0.5,
        }));
        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="amount">{String(data?.amount)}</div>
          </div>
        );
      }

      const { unmount } = render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

      unmount();

      // Wait to make sure we've passed the `refetchOnMountOrArgChange` value
      await waitMs(510);

      render(<User />, { wrapper: storeRef.wrapper });
      // Let's make sure we actually fetch, and we increment
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('2'));
    });

    test('refetchOnMountOrArgChange works as expected when changing skip from false->true', async () => {
      let data, isLoading, isFetching;
      function User() {
        const [skip, setSkip] = React.useState(true);
        ({ data, isLoading, isFetching } = api.endpoints.getIncrementedAmount.useQuery(undefined, {
          refetchOnMountOrArgChange: 0.5,
          skip,
        }));

        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="amount">{String(data?.amount)}</div>
            <button onClick={() => setSkip((prev) => !prev)}>change skip</button>;
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      expect(screen.getByTestId('isLoading').textContent).toBe('false');
      expect(screen.getByTestId('amount').textContent).toBe('undefined');

      fireEvent.click(screen.getByText('change skip'));

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));
    });

    test('refetchOnMountOrArgChange works as expected when changing skip from false->true with a cached query', async () => {
      // 1. we need to mount a skipped query, then toggle skip to generate a cached result
      // 2. we need to mount a skipped component after that, then toggle skip as well. should pull from the cache.
      // 3. we need to mount another skipped component, then toggle skip after the specified duration and expect the time condition to be satisfied

      let data, isLoading, isFetching;
      function User() {
        const [skip, setSkip] = React.useState(true);
        ({ data, isLoading, isFetching } = api.endpoints.getIncrementedAmount.useQuery(undefined, {
          skip,
          refetchOnMountOrArgChange: 0.5,
        }));

        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <div data-testid="amount">{String(data?.amount)}</div>
            <button onClick={() => setSkip((prev) => !prev)}>change skip</button>;
          </div>
        );
      }

      let { unmount } = render(<User />, { wrapper: storeRef.wrapper });

      // skipped queries do nothing by default, so we need to toggle that to get a cached result
      fireEvent.click(screen.getByText('change skip'));

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

      unmount();

      await waitMs(100);

      // This will pull from the cache as the time criteria is not met.
      ({ unmount } = render(<User />, {
        wrapper: storeRef.wrapper,
      }));

      // skipped queries return nothing
      expect(screen.getByTestId('isFetching').textContent).toBe('false');
      expect(screen.getByTestId('amount').textContent).toBe('undefined');

      // toggle skip -> true... won't refetch as the time critera is not met, and just loads the cached values
      fireEvent.click(screen.getByText('change skip'));
      expect(screen.getByTestId('isFetching').textContent).toBe('false');
      expect(screen.getByTestId('amount').textContent).toBe('1');

      unmount();

      await waitMs(500);

      ({ unmount } = render(<User />, {
        wrapper: storeRef.wrapper,
      }));

      // toggle skip -> true... will cause a refetch as the time criteria is now satisfied
      fireEvent.click(screen.getByText('change skip'));

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('2'));
    });
  });

  describe('useLazyQuery', () => {
    let data: any;

    afterEach(() => {
      data = undefined;
    });

    let getRenderCount: () => number = () => 0;
    test('useLazyQuery does not automatically fetch when mounted and has undefined data', async () => {
      function User() {
        const [fetchUser, { data: hookData, isFetching, isUninitialized }] = api.endpoints.getUser.useLazyQuery();
        getRenderCount = useRenderCounter();
        data = hookData;

        return (
          <div>
            <div data-testid="isUninitialized">{String(isUninitialized)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>

            <button data-testid="fetchButton" onClick={() => fetchUser(1)}>
              fetchUser
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      expect(getRenderCount()).toBe(1);

      await waitFor(() => expect(screen.getByTestId('isUninitialized').textContent).toBe('true'));
      await waitFor(() => expect(data).toBeUndefined());

      fireEvent.click(screen.getByTestId('fetchButton'));
      expect(getRenderCount()).toBe(2);

      await waitFor(() => expect(screen.getByTestId('isUninitialized').textContent).toBe('false'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(3);

      fireEvent.click(screen.getByTestId('fetchButton'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(5);
    });

    test('useLazyQuery accepts updated subscription options and only dispatches updateSubscriptionOptions when values are updated', async () => {
      let interval = 1000;
      function User() {
        const [options, setOptions] = React.useState<SubscriptionOptions>();
        const [fetchUser, { data: hookData, isFetching, isUninitialized }] = api.endpoints.getUser.useLazyQuery(
          options
        );
        getRenderCount = useRenderCounter();

        data = hookData;

        return (
          <div>
            <div data-testid="isUninitialized">{String(isUninitialized)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>

            <button data-testid="fetchButton" onClick={() => fetchUser(1)}>
              fetchUser
            </button>
            <button
              data-testid="updateOptions"
              onClick={() =>
                setOptions({
                  pollingInterval: interval,
                })
              }
            >
              updateOptions
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      expect(getRenderCount()).toBe(1); // hook mount

      await waitFor(() => expect(screen.getByTestId('isUninitialized').textContent).toBe('true'));
      await waitFor(() => expect(data).toBeUndefined());

      fireEvent.click(screen.getByTestId('fetchButton'));
      expect(getRenderCount()).toBe(2);

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(3);

      fireEvent.click(screen.getByTestId('updateOptions')); // setState = 1
      expect(getRenderCount()).toBe(4);

      fireEvent.click(screen.getByTestId('fetchButton')); // perform new request = 2
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(6);

      interval = 1000;

      fireEvent.click(screen.getByTestId('updateOptions')); // setState = 1
      expect(getRenderCount()).toBe(7);

      fireEvent.click(screen.getByTestId('fetchButton'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      expect(getRenderCount()).toBe(9);

      expect(
        storeRef.store.getState().actions.filter(api.internalActions.updateSubscriptionOptions.match)
      ).toHaveLength(1);
    });

    test('useLazyQuery accepts updated args and unsubscribes the original query', async () => {
      function User() {
        const [fetchUser, { data: hookData, isFetching, isUninitialized }] = api.endpoints.getUser.useLazyQuery();

        data = hookData;

        return (
          <div>
            <div data-testid="isUninitialized">{String(isUninitialized)}</div>
            <div data-testid="isFetching">{String(isFetching)}</div>

            <button data-testid="fetchUser1" onClick={() => fetchUser(1)}>
              fetchUser1
            </button>
            <button data-testid="fetchUser2" onClick={() => fetchUser(2)}>
              fetchUser2
            </button>
          </div>
        );
      }

      const { unmount } = render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isUninitialized').textContent).toBe('true'));
      await waitFor(() => expect(data).toBeUndefined());

      fireEvent.click(screen.getByTestId('fetchUser1'));

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      // Being that there is only the initial query, no unsubscribe should be dispatched
      expect(storeRef.store.getState().actions.filter(api.internalActions.unsubscribeQueryResult.match)).toHaveLength(
        0
      );

      fireEvent.click(screen.getByTestId('fetchUser2'));

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      expect(storeRef.store.getState().actions.filter(api.internalActions.unsubscribeQueryResult.match)).toHaveLength(
        1
      );

      fireEvent.click(screen.getByTestId('fetchUser1'));

      expect(storeRef.store.getState().actions.filter(api.internalActions.unsubscribeQueryResult.match)).toHaveLength(
        2
      );

      // we always unsubscribe the original promise and create a new one
      fireEvent.click(screen.getByTestId('fetchUser1'));
      expect(storeRef.store.getState().actions.filter(api.internalActions.unsubscribeQueryResult.match)).toHaveLength(
        3
      );

      unmount();

      // We unsubscribe after the component unmounts
      expect(storeRef.store.getState().actions.filter(api.internalActions.unsubscribeQueryResult.match)).toHaveLength(
        4
      );
    });
  });

  describe('useMutation', () => {
    test('useMutation hook sets and unsets the isLoading flag when running', async () => {
      function User() {
        const [updateUser, { isLoading }] = api.endpoints.updateUser.useMutation();

        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <button onClick={() => updateUser({ name: 'Banana' })}>Update User</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
      fireEvent.click(screen.getByText('Update User'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
    });

    test('useMutation hook sets data to the resolved response on success', async () => {
      const result = { name: 'Banana' };

      function User() {
        const [updateUser, { data }] = api.endpoints.updateUser.useMutation();

        return (
          <div>
            <div data-testid="result">{JSON.stringify(data)}</div>
            <button onClick={() => updateUser({ name: 'Banana' })}>Update User</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      fireEvent.click(screen.getByText('Update User'));
      await waitFor(() => expect(screen.getByTestId('result').textContent).toBe(JSON.stringify(result)));
    });
  });

  describe('usePrefetch', () => {
    test('usePrefetch respects force arg', async () => {
      const { usePrefetch } = api;
      const USER_ID = 4;
      function User() {
        const { isFetching } = api.endpoints.getUser.useQuery(USER_ID);
        const prefetchUser = usePrefetch('getUser', { force: true });

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <button onMouseEnter={() => prefetchUser(USER_ID, { force: true })} data-testid="highPriority">
              High priority action intent
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      // Resolve initial query
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      userEvent.hover(screen.getByTestId('highPriority'));
      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        error: undefined,
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: true,
        isSuccess: false,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.pending,
      });

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: false,
        isSuccess: true,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.fulfilled,
      });
    });

    test('usePrefetch does not make an additional request if already in the cache and force=false', async () => {
      const { usePrefetch } = api;
      const USER_ID = 2;

      function User() {
        // Load the initial query
        const { isFetching } = api.endpoints.getUser.useQuery(USER_ID);
        const prefetchUser = usePrefetch('getUser', { force: false });

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <button onMouseEnter={() => prefetchUser(USER_ID)} data-testid="lowPriority">
              Low priority user action intent
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      // Let the initial query resolve
      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      // Try to prefetch what we just loaded
      userEvent.hover(screen.getByTestId('lowPriority'));

      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: false,
        isSuccess: true,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.fulfilled,
      });

      await waitMs();

      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: false,
        isSuccess: true,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.fulfilled,
      });
    });

    test('usePrefetch respects ifOlderThan when it evaluates to true', async () => {
      const { usePrefetch } = api;
      const USER_ID = 47;

      function User() {
        // Load the initial query
        const { isFetching } = api.endpoints.getUser.useQuery(USER_ID);
        const prefetchUser = usePrefetch('getUser', { ifOlderThan: 0.2 });

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <button onMouseEnter={() => prefetchUser(USER_ID)} data-testid="lowPriority">
              Low priority user action intent
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      // Wait 400ms, making it respect ifOlderThan
      await waitMs(400);

      // This should run the query being that we're past the threshold
      userEvent.hover(screen.getByTestId('lowPriority'));
      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: true,
        isSuccess: false,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.pending,
      });

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        data: undefined,
        endpointName: 'getUser',
        fulfilledTimeStamp: expect.any(Number),
        isError: false,
        isLoading: false,
        isSuccess: true,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: QueryStatus.fulfilled,
      });
    });

    test('usePrefetch returns the last success result when ifOlderThan evalutes to false', async () => {
      const { usePrefetch } = api;
      const USER_ID = 2;

      function User() {
        // Load the initial query
        const { isFetching } = api.endpoints.getUser.useQuery(USER_ID);
        const prefetchUser = usePrefetch('getUser', { ifOlderThan: 10 });

        return (
          <div>
            <div data-testid="isFetching">{String(isFetching)}</div>
            <button onMouseEnter={() => prefetchUser(USER_ID)} data-testid="lowPriority">
              Low priority user action intent
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
      await waitMs();

      // Get a snapshot of the last result
      const latestQueryData = api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any);

      userEvent.hover(screen.getByTestId('lowPriority'));
      //  Serve up the result from the cache being that the condition wasn't met
      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual(latestQueryData);
    });

    test('usePrefetch executes a query even if conditions fail when the cache is empty', async () => {
      const { usePrefetch } = api;
      const USER_ID = 2;

      function User() {
        const prefetchUser = usePrefetch('getUser', { ifOlderThan: 10 });

        return (
          <div>
            <button onMouseEnter={() => prefetchUser(USER_ID)} data-testid="lowPriority">
              Low priority user action intent
            </button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });

      userEvent.hover(screen.getByTestId('lowPriority'));

      expect(api.endpoints.getUser.select(USER_ID)(storeRef.store.getState() as any)).toEqual({
        endpointName: 'getUser',
        isError: false,
        isLoading: true,
        isSuccess: false,
        isUninitialized: false,
        originalArgs: USER_ID,
        requestId: expect.any(String),
        startedTimeStamp: expect.any(Number),
        status: 'pending',
      });
    });
  });

  describe('useQuery and useMutation invalidation behavior', () => {
    const api = createApi({
      baseQuery: fetchBaseQuery({ baseUrl: 'https://example.com' }),
      entityTypes: ['User'],
      endpoints: (build) => ({
        checkSession: build.query<any, void>({
          query: () => '/me',
          provides: ['User'],
        }),
        login: build.mutation<any, any>({
          query: () => ({ url: '/login', method: 'POST' }),
          invalidates: ['User'],
        }),
      }),
    });

    const storeRef = setupApiStore(api, {
      actions(state: AnyAction[] = [], action: AnyAction) {
        return [...state, action];
      },
    });
    test('initially failed useQueries that provide an entity will refetch after a mutation invalidates it', async () => {
      const checkSessionData = { name: 'matt' };
      server.use(
        rest.get('https://example.com/me', (req, res, ctx) => {
          return res.once(ctx.status(500));
        }),
        rest.get('https://example.com/me', (req, res, ctx) => {
          return res(ctx.json(checkSessionData));
        }),
        rest.post('https://example.com/login', (req, res, ctx) => {
          return res(ctx.status(200));
        })
      );
      let data, isLoading, isError;
      function User() {
        ({ data, isError, isLoading } = api.endpoints.checkSession.useQuery());
        const [login, { isLoading: loginLoading }] = api.endpoints.login.useMutation();

        return (
          <div>
            <div data-testid="isLoading">{String(isLoading)}</div>
            <div data-testid="isError">{String(isError)}</div>
            <div data-testid="user">{JSON.stringify(data)}</div>
            <div data-testid="loginLoading">{String(loginLoading)}</div>
            <button onClick={() => login(null)}>Login</button>
          </div>
        );
      }

      render(<User />, { wrapper: storeRef.wrapper });
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));
      await waitFor(() => expect(screen.getByTestId('isError').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(''));

      fireEvent.click(screen.getByRole('button', { name: /Login/i }));

      await waitFor(() => expect(screen.getByTestId('loginLoading').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('loginLoading').textContent).toBe('false'));
      // login mutation will cause the original errored out query to refire, clearing the error and setting the user
      await waitFor(() => expect(screen.getByTestId('isError').textContent).toBe('false'));
      await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(JSON.stringify(checkSessionData)));

      const { checkSession, login } = api.endpoints;
      const completeSequence = [
        checkSession.matchPending,
        checkSession.matchRejected,
        login.matchPending,
        login.matchFulfilled,
        checkSession.matchPending,
        checkSession.matchFulfilled,
      ];

      matchSequence(storeRef.store.getState().actions, ...completeSequence);
    });
  });
});

describe('hooks with createApi defaults set', () => {
  const defaultApi = createApi({
    baseQuery: async (arg: any) => {
      await waitMs();
      if ('amount' in arg?.body) {
        amount += 1;
      }
      return { data: arg?.body ? { ...arg.body, ...(amount ? { amount } : {}) } : undefined };
    },
    endpoints: (build) => ({
      getIncrementedAmount: build.query<any, void>({
        query: () => ({
          url: '',
          body: {
            amount,
          },
        }),
      }),
    }),
    refetchOnMountOrArgChange: true,
  });

  const storeRef = setupApiStore(defaultApi);
  test('useQuery hook respects refetchOnMountOrArgChange: true when set in createApi options', async () => {
    let data, isLoading, isFetching;

    function User() {
      ({ data, isLoading } = defaultApi.endpoints.getIncrementedAmount.useQuery());
      return (
        <div>
          <div data-testid="isLoading">{String(isLoading)}</div>
          <div data-testid="amount">{String(data?.amount)}</div>
        </div>
      );
    }

    const { unmount } = render(<User />, { wrapper: storeRef.wrapper });

    await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));

    await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

    unmount();

    function OtherUser() {
      ({ data, isFetching } = defaultApi.endpoints.getIncrementedAmount.useQuery(undefined, {
        refetchOnMountOrArgChange: true,
      }));
      return (
        <div>
          <div data-testid="isFetching">{String(isFetching)}</div>
          <div data-testid="amount">{String(data?.amount)}</div>
        </div>
      );
    }

    render(<OtherUser />, { wrapper: storeRef.wrapper });
    // Let's make sure we actually fetch, and we increment
    await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));

    await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('2'));
  });

  test('useQuery hook overrides default refetchOnMountOrArgChange: false that was set by createApi', async () => {
    let data, isLoading, isFetching;

    function User() {
      ({ data, isLoading } = defaultApi.endpoints.getIncrementedAmount.useQuery());
      return (
        <div>
          <div data-testid="isLoading">{String(isLoading)}</div>
          <div data-testid="amount">{String(data?.amount)}</div>
        </div>
      );
    }

    let { unmount } = render(<User />, { wrapper: storeRef.wrapper });

    await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('isLoading').textContent).toBe('false'));

    await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));

    unmount();

    function OtherUser() {
      ({ data, isFetching } = defaultApi.endpoints.getIncrementedAmount.useQuery(undefined, {
        refetchOnMountOrArgChange: false,
      }));
      return (
        <div>
          <div data-testid="isFetching">{String(isFetching)}</div>
          <div data-testid="amount">{String(data?.amount)}</div>
        </div>
      );
    }

    render(<OtherUser />, { wrapper: storeRef.wrapper });

    await waitFor(() => expect(screen.getByTestId('isFetching').textContent).toBe('false'));
    await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('1'));
  });

  describe('selectFromResult behaviors', () => {
    let startingId = 3;
    const initialPosts = [
      { id: 1, name: 'A sample post', fetched_at: new Date().toUTCString() },
      { id: 2, name: 'A post about rtk-query', fetched_at: new Date().toUTCString() },
    ];
    let posts = [] as typeof initialPosts;

    beforeEach(() => {
      startingId = 3;
      posts = [...initialPosts];

      const handlers = [
        rest.get('http://example.com/posts', (req, res, ctx) => {
          return res(ctx.json(posts));
        }),
        rest.put<Partial<Post>>('http://example.com/posts/:id', (req, res, ctx) => {
          const id = Number(req.params.id);
          const idx = posts.findIndex((post) => post.id === id);

          const newPosts = posts.map((post, index) =>
            index !== idx
              ? post
              : {
                  ...req.body,
                  id,
                  name: req.body.name || post.name,
                  fetched_at: new Date().toUTCString(),
                }
          );
          posts = [...newPosts];

          return res(ctx.json(posts));
        }),
        rest.post('http://example.com/posts', (req, res, ctx) => {
          let post = req.body as Omit<Post, 'id'>;
          startingId += 1;
          posts.concat({ ...post, fetched_at: new Date().toISOString(), id: startingId });
          return res(ctx.json(posts));
        }),
      ];

      server.use(...handlers);
    });

    interface Post {
      id: number;
      name: string;
      fetched_at: string;
    }

    type PostsResponse = Post[];

    const api = createApi({
      baseQuery: fetchBaseQuery({ baseUrl: 'http://example.com/' }),
      entityTypes: ['Posts'],
      endpoints: (build) => ({
        getPosts: build.query<PostsResponse, void>({
          query: () => ({ url: 'posts' }),
          provides: (result) => (result ? result.map(({ id }) => ({ type: 'Posts', id })) : []),
        }),
        updatePost: build.mutation<Post, Partial<Post>>({
          query: ({ id, ...body }) => ({
            url: `posts/${id}`,
            method: 'PUT',
            body,
          }),
          invalidates: (result, error, { id }) => [{ type: 'Posts', id }],
        }),
        addPost: build.mutation<Post, Partial<Post>>({
          query: (body) => ({
            url: `posts`,
            method: 'POST',
            body,
          }),
          invalidates: ['Posts'],
        }),
      }),
    });

    const storeRef = setupApiStore(api);

    // @pre41-ts-ignore
    expectExactType(api.useGetPostsQuery)(api.endpoints.getPosts.useQuery);
    // @pre41-ts-ignore
    expectExactType(api.useUpdatePostMutation)(api.endpoints.updatePost.useMutation);
    // @pre41-ts-ignore
    expectExactType(api.useAddPostMutation)(api.endpoints.addPost.useMutation);

    test('useQueryState serves a deeply memoized value and does not rerender unnecessarily', async () => {
      function Posts() {
        const { data: posts } = api.endpoints.getPosts.useQuery();
        const [addPost] = api.endpoints.addPost.useMutation();
        return (
          <div>
            <button data-testid="addPost" onClick={() => addPost({ name: `some text ${posts?.length}` })}>
              Add random post
            </button>
          </div>
        );
      }

      function SelectedPost() {
        const [renderCount, setRenderCount] = React.useState(0);
        const { post } = api.endpoints.getPosts.useQueryState(undefined, {
          selectFromResult: ({ data }) => ({ post: data?.find((post) => post.id === 1) }),
        });

        /**
         * Notes on the renderCount behavior
         *
         * We initialize at 0, and the first render will bump that 1 while post is `undefined`.
         * Once the request resolves, it will be at 2. What we're looking for is to make sure that
         * any requests that don't directly change the value of the selected item will have no impact
         * on rendering.
         */

        React.useEffect(() => {
          setRenderCount((prev) => prev + 1);
        }, [post]);

        return <div data-testid="renderCount">{String(renderCount)}</div>;
      }

      render(
        <div>
          <Posts />
          <SelectedPost />
        </div>,
        { wrapper: storeRef.wrapper }
      );

      expect(screen.getByTestId('renderCount').textContent).toBe('1');

      const addBtn = screen.getByTestId('addPost');

      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));

      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));
      // We fire off a few requests that would typically cause a rerender as JSON.parse() on a request would always be a new object.
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));
      // Being that it didn't rerender, we can be assured that the behavior is correct
    });

    test('useQuery with selectFromResult option serves a deeply memoized value and does not rerender unnecessarily', async () => {
      function Posts() {
        const { data: posts } = api.endpoints.getPosts.useQuery();
        const [addPost] = api.endpoints.addPost.useMutation();
        return (
          <div>
            <button
              data-testid="addPost"
              onClick={() => addPost({ name: `some text ${posts?.length}`, fetched_at: new Date().toISOString() })}
            >
              Add random post
            </button>
          </div>
        );
      }

      function SelectedPost() {
        const [renderCount, setRenderCount] = React.useState(0);
        const { post } = api.endpoints.getPosts.useQuery(undefined, {
          selectFromResult: ({ data }) => ({ post: data?.find((post) => post.id === 1) }),
        });

        React.useEffect(() => {
          setRenderCount((prev) => prev + 1);
        }, [post]);

        return <div data-testid="renderCount">{String(renderCount)}</div>;
      }

      render(
        <div>
          <Posts />
          <SelectedPost />
        </div>,
        { wrapper: storeRef.wrapper }
      );
      expect(screen.getByTestId('renderCount').textContent).toBe('1');

      const addBtn = screen.getByTestId('addPost');

      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));

      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));
    });

    test('useQuery with selectFromResult option serves a deeply memoized value, then ONLY updates when the underlying data changes', async () => {
      let expectablePost: Post | undefined;
      function Posts() {
        const { data: posts } = api.endpoints.getPosts.useQuery();
        const [addPost] = api.endpoints.addPost.useMutation();
        const [updatePost] = api.endpoints.updatePost.useMutation();

        return (
          <div>
            <button
              data-testid="addPost"
              onClick={() => addPost({ name: `some text ${posts?.length}`, fetched_at: new Date().toISOString() })}
            >
              Add random post
            </button>
            <button data-testid="updatePost" onClick={() => updatePost({ id: 1, name: 'supercoooll!' })}>
              Update post
            </button>
          </div>
        );
      }

      function SelectedPost() {
        const [renderCount, setRenderCount] = React.useState(0);
        const { post } = api.endpoints.getPosts.useQuery(undefined, {
          selectFromResult: ({ data }) => ({ post: data?.find((post) => post.id === 1) }),
        });

        React.useEffect(() => {
          setRenderCount((prev) => prev + 1);
          expectablePost = post;
        }, [post]);

        return (
          <div>
            <div data-testid="postName">{post?.name}</div>
            <div data-testid="renderCount">{String(renderCount)}</div>
          </div>
        );
      }

      render(
        <div>
          <Posts />
          <SelectedPost />
        </div>,
        { wrapper: storeRef.wrapper }
      );
      expect(screen.getByTestId('renderCount').textContent).toBe('1');

      const addBtn = screen.getByTestId('addPost');
      const updateBtn = screen.getByTestId('updatePost');

      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('2'));

      fireEvent.click(updateBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('3'));
      expect(expectablePost?.name).toBe('supercoooll!');

      fireEvent.click(addBtn);
      await waitFor(() => expect(screen.getByTestId('renderCount').textContent).toBe('3'));
    });
  });
});
