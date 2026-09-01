/**
 * Serializes Save commands and records which document revision each write
 * represents. A completed older write may be reported, but can never mark
 * newer edits clean.
 */
export class SaveCoordinator {
  #revision = 0;
  #tail = Promise.resolve();

  get revision() {
    return this.#revision;
  }

  noteMutation() {
    this.#revision += 1;
    return this.#revision;
  }

  resetBaseline() {
    this.#revision += 1;
    return this.#revision;
  }

  isCurrent(revision) {
    return revision === this.#revision;
  }

  enqueue(operation) {
    const run = () => operation(this.#revision);
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => {});
    return result;
  }
}
