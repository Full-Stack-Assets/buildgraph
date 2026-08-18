export type BoundedAsyncQueueOptions = {
  concurrency: number;
  maxPending: number;
};

export class BoundedAsyncQueue {
  readonly #concurrency: number;
  readonly #maxPending: number;
  readonly #queue: Array<() => void> = [];
  #active = 0;

  constructor(options: BoundedAsyncQueueOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("queue concurrency must be a positive integer");
    }
    if (!Number.isInteger(options.maxPending) || options.maxPending < 0) {
      throw new Error("queue maxPending must be a non-negative integer");
    }

    this.#concurrency = options.concurrency;
    this.#maxPending = options.maxPending;
  }

  get active(): number {
    return this.#active;
  }

  get pending(): number {
    return this.#queue.length;
  }

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#concurrency && this.#queue.length >= this.#maxPending) {
      return Promise.reject(new Error("queue capacity exceeded"));
    }

    return new Promise<T>((resolve, reject) => {
      this.#queue.push(() => {
        this.#active += 1;
        void work()
          .then(resolve, reject)
          .finally(() => {
            this.#active -= 1;
            this.#drain();
          });
      });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#concurrency && this.#queue.length > 0) {
      const start = this.#queue.shift();
      start?.();
    }
  }
}
