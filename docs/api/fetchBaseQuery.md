---
id: fetchBaseQuery
title: fetchBaseQuery
sidebar_label: fetchBaseQuery
hide_title: true
hide_table_of_contents: false
---

# `fetchBaseQuery`

This is a very small wrapper around `fetch` that aims to simplify requests. It is not a full-blown replacement for `axios`, `superagent`, or any other more heavy-weight library, but it will cover the large majority of your needs.

It takes all standard options from fetch's [`RequestInit`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch) interface, as well as `baseUrl`, a `prepareHeaders` function, and an optional `fetch` function.

- `baseUrl` _(required)_
  - Typically a string like `https://api.your-really-great-app.com/v1/`. If you don't provide a `baseUrl`, it defaults to a relative path from where the request is being made. You should most likely _always_ specify this.
- `prepareHeaders` _(optional)_

  - Allows you to inject headers on every request. You can specify headers at the endpoint level, but you'll typically want to set common headers like `authorization` here. As a convience mechanism, the second argument allows you to use `getState` to access your redux store in the event you store information you'll need there such as an auth token.

  - ```ts title="prepareHeaders signature"
    (headers: Headers, api: { getState: () => unknown }) => Headers;
    ```

- `fetchFn` _(optional)_
  - A fetch function that overrides the default on the window. Can be useful in SSR environments where you may need to leverage `isomorphic-fetch` or `cross-fetch`.

```ts title="Return types of fetchBaseQuery"
Promise<{
    data: any;
    error?: undefined;
} | {
    error: {
        status: number;
        data: any;
    };
    data?: undefined;
}>
```

### Using `fetchBaseQuery`

To use it, import it when you are [creating an API service definition](../introduction/getting-started#create-an-api-service).

```ts title="src/services/pokemon.ts"
import { createApi, fetchBaseQuery } from '@rtk-incubator/rtk-query';

export const pokemonApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: 'https://pokeapi.co/api/v2/' }), // Set the baseUrl for every endpoint below
  endpoints: (builder) => ({
    getPokemonByName: builder.query({
      query: (name: string) => `pokemon/${name}`, // Will make a request like https://pokeapi.co/api/v2/bulbasaur
    }),
    updatePokemon: builder.mutation({
      query: ({ name, patch }) => ({
        url: `pokemon/${name}`,
        method: 'PATCH', // When performing a mutation, you typically use a method of PATCH/PUT/POST/DELETE for REST endpoints
        body: patch, // fetchBaseQuery automatically adds `content-type: application/json` to the Headers and calls `JSON.stringify(patch)`
      }),
    }),
  }),
});
```

### Setting default headers on requests

The most common use case for `prepareHeaders` would be to automatically include `authorization` headers for your API requests.

```ts title="Setting a token from a redux store value
const baseQuery = fetchBaseQuery({
  baseUrl,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.token;

    // If we have a token set in state, let's assume that we should be passing it.
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }

    return headers;
  },
});
```

### Individual query options

There is more behavior that you can define on a per-request basis that extends the default options available to the `RequestInit` interface.

- [`params`](#setting-the-query-string)
- [`body`](#setting-the-body)
- [`responseHandler`](#parsing-a-Response)
- [`validateStatus`](#handling-non-standard-response-status-codes)

```ts title="endpoint request options"
interface FetchArgs extends RequestInit {
  url: string;
  params?: Record<string, any>;
  body?: any;
  responseHandler?: 'json' | 'text' | ((response: Response) => Promise<any>);
  validateStatus?: (response: Response, body: any) => boolean;
}

const defaultValidateStatus = (response: Response) => response.status >= 200 && response.status <= 299;
```

### Setting the body

By default, `fetchBaseQuery` assumes that every request you make will be `json`, so in those cases all you have to do is set the `url` and pass a `body` object when appropriate. For other implementations, you can manually set the `Headers` to specify the content type.

#### json

```ts
 // omitted
  endpoints: (builder) => ({
    updateUser: builder.query({
      query: (user: Record<string, string>) => ({
        url: `users`,
        method: 'PUT',
        body: user // Body is automatically converted to json with the correct headers
      }),
    }),
```

#### text

```ts
 // omitted
  endpoints: (builder) => ({
    updateUser: builder.query({
      query: (user: Record<string, string>) => ({
        url: `users`,
        method: 'PUT',
        headers: {
            'content-type': 'text/plain',
        },
        body: user
      }),
    }),
```

### Setting the query string

`fetchBaseQuery` provides a simple mechanism that converts an `object` to a serialized query string. If this doesn't suit your needs, you can always build your own querystring and set it in the `url`.

```ts
  endpoints: (builder) => ({
    updateUser: builder.query({
      query: (user: Record<string, string>) => ({
        url: `users`,
        params: user // The user object is automatically converted and produces a request like /api/users?first_name=test&last_name=example
      }),
    }),
```

### Parsing a Response

By default, `fetchBaseQuery` assumes that every `Response` you get will be parsed as `json`. In the event that you don't want that to happen, you can specify an alternative response handler like `text`, or take complete control and use a custom function that accepts the raw `Response` object &mdash; allowing you to use any [`Body` method](https://developer.mozilla.org/en-US/docs/Web/API/Body).

```ts title="Parse a Response as text"
export const customApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: '/api/' }),
  endpoints: (builder) => ({
    getUsers: builder.query({
      query: () => ({
        url: `users`,
        responseHandler: (response) => response.text(), // This is the same as passing 'text'
      }),
    }),
  }),
});
```

:::note Note about responses that return an undefined body
If you make a `json` request to an API that only returns a `200` with an undefined body, `fetchBaseQuery` will pass that through as `undefined` and will not try to parse it as `json`. This can be common with some APIs, especially on `delete` requests.
:::

### Handling non-standard Response status codes

By default, `fetchBaseQuery` will `reject` any `Response` that does not have a status code of `2xx` and set it to `error`. This is the same behavior you've most likely experienced with `axios` and other popular libraries. In the event that you have a non-standard API you're dealing with, you can use the `validateStatus` option to customize this behavior.

```ts title="Using a custom validateStatus"
export const customApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: '/api/' }), // Set the baseUrl for every endpoint below
  endpoints: (builder) => ({
    getUsers: builder.query({
      query: () => ({
        url: `users`,
        validateStatus: (response, result) => response.status === 200 && !result.isError, // Our tricky API always returns a 200, but sets an `isError` property when there is an error.
      }),
    }),
  }),
});
```
