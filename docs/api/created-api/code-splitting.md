---
id: code-splitting
title: 'API Slices: Code Splitting and Generation'
sidebar_label: Code Splitting
hide_title: true
---

# API Slices: Code Splitting and Generation

Each API slice allows [additional endpoint definitions to be injected at runtime](../../concepts/code-splitting.md) after the initial API slice has been defined. This can be beneficial for apps that may have _many_ endpoints.

The individual API slice endpoint definitions can also be split across multiple files. This is primarily useful for working with API slices that were [code-generated from an API schema file](../../concepts/code-generation.md), allowing you to add additional custom behavior and configuration to a set of automatically-generated endpoint definitions.

Each API slice object has `injectEndpoints` and `enhanceEndpoints` functions to support these use cases.

## `injectEndpoints`

#### Signature

```ts
const injectEndpoints = (endpointOptions: InjectedEndpointOptions) => EnhancedApiSlice;

interface InjectedEndpointOptions {
  endpoints: (build: EndpointBuilder) => NewEndpointDefinitions;
  overrideExisting?: boolean;
}
```

#### Description

Accepts an options object containing the same `endpoints` builder callback you would pass to [`createApi.endpoints`](../createApi.md#endpoints). Any endpoint definitions defined using that builder will be merged into the existing endpoint definitions for this API slice using a shallow merge, so any new endpoint definitions will override existing endpoints with the same name.

Returns an updated and enhanced version of the API slice object, containing the combined endpoint definitions.

The `overrideExisting` flag controls a development-only warning that notifies you if there is a name clash between endpoint definitions. When set to `true`, the warning will not be printed.

This method is primarily useful for code splitting and hot reloading.

## `enhanceEndpoints`

#### Signature

```ts
const enhanceEndpoints = (endpointOptions: EnhanceEndpointsOptions) => EnhancedApiSlice;

interface EnhanceEndpointsOptions {
  addEntityTypes?: readonly string[];
  endpoints?: Record<string, Partial<EndpointDefinition>>;
}
```

#### Description

Any provided entity types or endpoint definitions will be merged into the existing endpoint definitions for this API slice. Unlike `injectEndpoints`, the partial endpoint definitions will not _replace_ existing definitions, but are rather merged together on a per-definition basis (ie, `Object.assign(existingEndpoint, newPartialEndpoint)`).

Returns an updated and enhanced version of the API slice object, containing the combined endpoint definitions.

This is primarily useful for taking an API slice object that was code-generated from an API schema file like OpenAPI, and adding additional specific hand-written configuration for cache invalidation management on top of the generated endpoint definitions.
