/** Faux CacheStorage en mémoire pour tester le Service Worker sans navigateur. */
export class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    const hit = this.entries.get(key);
    return hit === undefined ? undefined : hit.clone();
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this.entries.set(key, response);
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.entries.delete(key);
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let store = this.stores.get(name);
    if (store === undefined) {
      store = new FakeCache();
      this.stores.set(name, store);
    }
    return store;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}
