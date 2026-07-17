export type CoordinatedImapSession = {
  close(): Promise<void>;
};

export type ImapClientSession = CoordinatedImapSession & {
  client: unknown;
};

export type ImapSessionCoordinator<Session extends CoordinatedImapSession> = {
  run<Result>(
    accountId: string,
    connect: () => Promise<Session>,
    operation: (session: Session) => Promise<Result>,
  ): Promise<Result>;
  closeAccount(accountId: string): Promise<void>;
  closeAll(): Promise<void>;
};

type AccountSessionState<Session> = {
  session?: Session;
  tail: Promise<void>;
  leaseTimer?: ReturnType<typeof setTimeout>;
};

export function createImapSessionCoordinator<Session extends CoordinatedImapSession>(
  leaseMs = 10_000,
): ImapSessionCoordinator<Session> {
  const accountStates = new Map<string, AccountSessionState<Session>>();
  let closingAll = false;

  return {
    run<Result>(
      accountId: string,
      connect: () => Promise<Session>,
      operation: (session: Session) => Promise<Result>,
    ): Promise<Result> {
      if (closingAll) {
        return Promise.reject(new Error("IMAP sessions are closing"));
      }

      const state = stateFor(accountId);
      const result = state.tail.then(async () => {
        clearLease(state);

        if (!state.session) {
          state.session = await connect();
        }

        const session = state.session;

        try {
          const value = await operation(session);
          scheduleLeaseExpiry(state, session);
          return value;
        } catch (error) {
          state.session = undefined;
          await closeWithoutMaskingError(session);
          throw error;
        }
      });

      state.tail = result.then(
        () => undefined,
        () => undefined,
      );

      return result;
    },
    async closeAccount(accountId) {
      const state = accountStates.get(accountId);
      if (state) {
        await queueClose(state);
      }
    },
    async closeAll() {
      closingAll = true;

      try {
        await Promise.all([...accountStates.values()].map(queueClose));
      } finally {
        closingAll = false;
      }
    },
  };

  function stateFor(accountId: string): AccountSessionState<Session> {
    const existing = accountStates.get(accountId);
    if (existing) {
      return existing;
    }

    const state: AccountSessionState<Session> = { tail: Promise.resolve() };
    accountStates.set(accountId, state);
    return state;
  }

  function clearLease(state: AccountSessionState<Session>): void {
    if (state.leaseTimer) {
      clearTimeout(state.leaseTimer);
      state.leaseTimer = undefined;
    }
  }

  function scheduleLeaseExpiry(state: AccountSessionState<Session>, session: Session): void {
    clearLease(state);
    state.leaseTimer = setTimeout(() => {
      state.leaseTimer = undefined;
      const close = state.tail.then(async () => {
        if (state.session !== session) {
          return;
        }

        state.session = undefined;
        await session.close();
      });

      state.tail = close.then(
        () => undefined,
        () => undefined,
      );
    }, leaseMs);
  }

  async function queueClose(state: AccountSessionState<Session>): Promise<void> {
    clearLease(state);
    const close = state.tail.then(async () => {
      clearLease(state);
      const session = state.session;
      state.session = undefined;

      if (session) {
        await closeWithoutMaskingError(session);
      }
    });

    state.tail = close.then(
      () => undefined,
      () => undefined,
    );
    await close;
  }
}

async function closeWithoutMaskingError(session: CoordinatedImapSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Preserve the operation failure that made the connection unusable.
  }
}
