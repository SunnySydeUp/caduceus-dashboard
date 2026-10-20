// Which answer a block shows when it has asked more than once (`use-block.ts`). A block asks at once, and again when Hermes comes up or says its data moved. The screen
// is waiting for the first answer, so an answer is never thrown away only because a newer ask is out behind it: it is shown, and the newer answer replaces it.

/** The token an ask hands out, and the answer returns to `accepts`. */
export interface Ask {
  epoch: number;
  n: number;
}

export class BlockAsks {
  #epoch = 0;
  #asked = 0;
  #shown = 0;

  /** A new ask. */
  ask(): Ask {
    return { epoch: this.#epoch, n: ++this.#asked };
  }

  /**
   * Whether the answer to `ask` shows. Not one to an ask made before the scope changed (`drop`), and not one older than the answer already on screen (it came in out of
   * order). A failure shows only when no newer ask is out: an older ask that failed, say before Hermes was up, must not put an error over the answer that is on its way.
   */
  accepts(ask: Ask, failed: boolean): boolean {
    if (ask.epoch !== this.#epoch || ask.n <= this.#shown) return false;
    if (failed && ask.n !== this.#asked) return false;
    this.#shown = ask.n;
    return true;
  }

  /** The scope changed (another profile, Hermes not ready): every answer still out belongs to the old one. */
  drop(): void {
    this.#epoch += 1;
  }
}
