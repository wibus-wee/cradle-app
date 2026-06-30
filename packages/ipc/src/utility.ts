type AlwaysPromise<T> = Promise<Awaited<T>>

/** Extracts typed method signatures from a service class, making all returns Promise-wrapped. */
export type ExtractServiceMethods<T> = {
  // eslint-disable-next-line ts/no-explicit-any
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (
    ...args: infer Args
  ) => infer Output
    ? Args extends []
      ? () => AlwaysPromise<Output>
      : Args extends [infer Input]
        ? (input: Input) => AlwaysPromise<Output>
        : (...args: Args) => AlwaysPromise<Output>
    : never
}

/** Maps a record of service constructors (or instances) to their typed IPC method signatures. */
export type MergeIpcService<T> = {
  // eslint-disable-next-line ts/no-explicit-any
  [K in keyof T]: T[K] extends new (...args: any[]) => infer Instance
    ? ExtractServiceMethods<Instance>
    : T[K] extends infer Instance
      ? ExtractServiceMethods<Instance>
      : never
}
