/**
 * An IndexedDB whose every open fails, as one does when the browser cannot read the files a
 * newer engine wrote.
 */

/**
 * A factory whose `open` fails a moment later with an `UnknownError`.
 *
 * @returns The factory, to set as `globalThis.indexedDB`.
 */
export function failingIndexedDb(): IDBFactory {
  return {
    open: () => {
      const error = new DOMException("the database could not be opened", "UnknownError");
      const request = { error } as unknown as IDBOpenDBRequest;
      setTimeout(() => request.onerror?.call(request, new Event("error")));
      return request;
    },
  } as unknown as IDBFactory;
}
