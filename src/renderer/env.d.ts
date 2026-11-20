declare global {
  interface Window {
    /** Asks main for this document's RPC port; it arrives as a window message. */
    kvist: { connect: () => void };
  }
}

export {};
